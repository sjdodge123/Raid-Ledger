/**
 * Tests for Sentry instrumentation configuration (ROK-366).
 * Verifies that pg_catalog spans are filtered out to suppress false-positive N+1 noise.
 */

async function loadInstrument(
  env: Record<string, string | undefined> = {},
): Promise<{
  sentryInitMock: jest.MockedFunction<
    (options?: Record<string, unknown>) => void
  >;
}> {
  // Save and restore env
  const saved: Record<string, string | undefined> = {};
  for (const key of ['NODE_ENV', 'DISABLE_TELEMETRY', 'SENTRY_ENVIRONMENT']) {
    saved[key] = process.env[key];
    if (key in env) {
      if (env[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = env[key];
      }
    } else {
      delete process.env[key];
    }
  }

  jest.resetModules();

  // Register the mock inside resetModules so it is fresh
  jest.mock('@sentry/nestjs', () => ({
    init: jest.fn(),
  }));

  // Re-import to trigger module-level side effects
  await import('./instrument.js');

  // Retrieve the fresh mock
  const sentry = (await import('@sentry/nestjs')) as unknown as {
    init: jest.MockedFunction<(options?: Record<string, unknown>) => void>;
  };

  // Restore env
  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }

  return { sentryInitMock: sentry.init };
}

function describeSentryInstrumentTs() {
  afterEach(() => {
    jest.resetModules();
  });

  describe('when not in production (default)', () => {
    let sentryInitMock: jest.MockedFunction<
      (options?: Record<string, unknown>) => void
    >;

    beforeEach(async () => {
      ({ sentryInitMock } = await loadInstrument({
        DISABLE_TELEMETRY: undefined,
      }));
    });

    it('does NOT call Sentry.init in development', () => {
      expect(sentryInitMock).not.toHaveBeenCalled();
    });
  });

  describe('when NODE_ENV=production', () => {
    let sentryInitMock: jest.MockedFunction<
      (options?: Record<string, unknown>) => void
    >;

    beforeEach(async () => {
      ({ sentryInitMock } = await loadInstrument({
        NODE_ENV: 'production',
        DISABLE_TELEMETRY: undefined,
      }));
    });

    it('calls Sentry.init', () => {
      expect(sentryInitMock).toHaveBeenCalledTimes(1);
    });

    it('sets tracesSampleRate to 0.1 in production', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(config['tracesSampleRate']).toBe(0.1);
    });

    it('sets environment tag to production', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      expect(config['environment']).toBe('production');
    });

    // ── ROK-1329: honor SENTRY_ENVIRONMENT so fleet runners don't pollute
    // the prod Sentry inbox. The allinone image bakes NODE_ENV=production, so
    // Sentry.init still fires for fleet envs; the environment tag is what keeps
    // their events in a separate bucket. Default stays 'production' so the
    // Synology NAS keeps reporting as prod with zero config change.
    describe('ROK-1329: SENTRY_ENVIRONMENT override', () => {
      it('defaults environment to production when SENTRY_ENVIRONMENT is unset', async () => {
        const { sentryInitMock: mock } = await loadInstrument({
          NODE_ENV: 'production',
          DISABLE_TELEMETRY: undefined,
          SENTRY_ENVIRONMENT: undefined,
        });
        const config = mock.mock.calls[0][0] as Record<string, unknown>;
        expect(config['environment']).toBe('production');
      });

      it('uses SENTRY_ENVIRONMENT when set (fleet per-slot bucket)', async () => {
        const { sentryInitMock: mock } = await loadInstrument({
          NODE_ENV: 'production',
          DISABLE_TELEMETRY: undefined,
          SENTRY_ENVIRONMENT: 'fleet-slot-2',
        });
        const config = mock.mock.calls[0][0] as Record<string, unknown>;
        expect(config['environment']).toBe('fleet-slot-2');
      });
    });

    it('includes ignoreSpans with pg_catalog filter', () => {
      const config = sentryInitMock.mock.calls[0][0] as Record<string, unknown>;
      const ignoreSpans = config['ignoreSpans'] as RegExp[];

      expect(Array.isArray(ignoreSpans)).toBe(true);
      const regex = ignoreSpans[0];
      expect(regex.test('pg_catalog.pg_type')).toBe(true);
    });

    describe('beforeSend filter', () => {
      type SentryEvent = {
        exception?: { values?: { type?: string; value?: string }[] };
        fingerprint?: string[];
        tags?: Record<string, unknown>;
        extra?: Record<string, unknown>;
      };
      type BeforeSend = (event: SentryEvent) => SentryEvent | null;

      function getBeforeSend(): BeforeSend {
        const config = sentryInitMock.mock.calls[0][0] as Record<
          string,
          unknown
        >;
        return config['beforeSend'] as BeforeSend;
      }

      it('drops ThrottlerException events', () => {
        const result = getBeforeSend()({
          exception: { values: [{ type: 'ThrottlerException' }] },
        });
        expect(result).toBeNull();
      });

      it('drops InternalOAuthError events (ROK-668)', () => {
        const result = getBeforeSend()({
          exception: { values: [{ type: 'InternalOAuthError' }] },
        });
        expect(result).toBeNull();
      });

      it('drops intentional no_snapshot_yet 503s (ROK-1143)', () => {
        const result = getBeforeSend()({
          exception: {
            values: [
              {
                type: 'HttpException',
                value: "{ error: 'no_snapshot_yet' }",
              },
            ],
          },
        });
        expect(result).toBeNull();
      });

      it('still reports real 5xx HttpExceptions', () => {
        const event: SentryEvent = {
          exception: {
            values: [{ type: 'HttpException', value: 'Internal Server Error' }],
          },
        };
        expect(getBeforeSend()(event)).toBe(event);
      });

      it('still reports unrelated exceptions', () => {
        const event: SentryEvent = {
          exception: {
            values: [
              {
                type: 'TypeError',
                value: "Cannot read property 'x' of undefined",
              },
            ],
          },
        };
        expect(getBeforeSend()(event)).toBe(event);
      });

      it('passes through events without an exception payload', () => {
        const event: SentryEvent = {};
        expect(getBeforeSend()(event)).toBe(event);
      });

      // ── ROK-1365: drop synthetic CSP-report noise ──
      //
      // The /csp-report controller captures real browser violations via
      // captureMessage (tag source='csp_report', report under extra.report).
      // Curl-driven probes / scanners hit the endpoint with a hand-crafted
      // `example.*` document-uri or `curl` UA. The drop MUST match those but
      // MUST NOT suppress a genuine violation whose document-uri is real — the
      // regex runs against JSON.stringify(report), so the negative guard below
      // is load-bearing security telemetry coverage.
      describe('ROK-1365: CSP-report noise drop', () => {
        it('drops a synthetic report with an example.com document-uri', () => {
          const result = getBeforeSend()({
            tags: { source: 'csp_report' },
            extra: { report: { 'document-uri': 'https://example.com/' } },
          });
          expect(result).toBeNull();
        });

        it('drops a curl-UA probe report', () => {
          const result = getBeforeSend()({
            tags: { source: 'csp_report' },
            extra: { report: { 'user-agent': 'curl/8.4.0', probe: true } },
          });
          expect(result).toBeNull();
        });

        it('still reports a genuine CSP violation (real document-uri)', () => {
          const event: SentryEvent = {
            tags: { source: 'csp_report' },
            extra: {
              report: {
                'document-uri': 'https://raid.gamernight.net/',
                'blocked-uri': 'eval',
                'violated-directive': 'script-src',
              },
            },
          };
          expect(getBeforeSend()(event)).toBe(event);
        });
      });

      // ── ROK-1260: defense-in-depth drop for DiscordAPIError noise ──
      //
      // The primary fix is the processor's classifier (AC-1), which catches
      // 50278/50007 BEFORE the BullMQ auto-instrumentation captures them.
      // This `beforeSend` branch is the second line of defense — if anything
      // ever re-throws these errors (manual capture, third-party middleware,
      // future refactor), Sentry MUST still drop them so the noise can't come
      // back.
      describe('ROK-1260: DiscordAPIError 50278/50007 drop', () => {
        it('drops DiscordAPIError events with code 50278 in the message', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value:
                    'Cannot send messages to this user due to having no mutual guilds with the recipient (code 50278)',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops DiscordAPIError events with code 50007 in the message', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value: 'Cannot send messages to this user (code 50007)',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops DiscordAPIError events whose value mentions "no mutual guilds" (defense-in-depth)', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  // Message variant without the bracketed code — must still drop.
                  value: 'Recipient has no mutual guilds with the bot',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops DiscordAPIError events whose value mentions "Cannot send messages to this user" (defense-in-depth)', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value: 'Cannot send messages to this user',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('does NOT drop unrelated DiscordAPIError events', () => {
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value: 'Unknown Channel (code 10003)',
                },
              ],
            },
          };
          expect(getBeforeSend()(event)).toBe(event);
        });

        // ── ROK-1354: production bracketed exception type ──
        //
        // discord.js v14's DiscordAPIError reports its Sentry `type` as the
        // bracketed name `DiscordAPIError[<code>]` (e.g. `DiscordAPIError[50007]`),
        // never the bare string. ROK-1260's filter compared `=== 'DiscordAPIError'`
        // and so never fired in prod. The filter must use `startsWith` so
        // bracketed types are dropped.
        it('drops bracketed DiscordAPIError[50007] type (production shape)', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError[50007]',
                  value: 'Cannot send messages to this user (code 50007)',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops bracketed DiscordAPIError[50278] type (production shape)', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError[50278]',
                  value:
                    'Cannot send messages to this user due to having no mutual guilds (code 50278)',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        // ── ROK-1354: 10013 Unknown User added to the drop filter ──
        it('drops bracketed DiscordAPIError[10013] Unknown User type (ROK-1354)', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError[10013]',
                  value: 'Unknown User (code 10013)',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops DiscordAPIError events mentioning "Unknown User" (defense-in-depth, ROK-1354)', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError[10013]',
                  value: 'Unknown User',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('does NOT drop events with the 50278 code but a different exception type', () => {
          // A wrapper error or unrelated exception type that happens to
          // contain "code 50278" in its message should still report — only
          // DiscordAPIError-typed events are suppressed.
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'TypeError',
                  value: 'Saw stray reference to code 50278 in a stack trace',
                },
              ],
            },
          };
          expect(getBeforeSend()(event)).toBe(event);
        });
      });

      // ── ROK-1162: Sentry noise reduction ──
      describe('ROK-1162: ConflictException applyStatusUpdate drop', () => {
        it('drops HttpException with "status changed concurrently" value', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'HttpException',
                  value:
                    "Lineup abc-123 status changed concurrently; expected 'pending'",
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('does NOT drop unrelated HttpException 409s', () => {
          const event: SentryEvent = {
            exception: {
              values: [
                { type: 'HttpException', value: 'Duplicate signup detected' },
              ],
            },
          };
          expect(getBeforeSend()(event)).toBe(event);
        });

        it('does NOT confuse no_snapshot_yet 503s with the concurrent-status drop (cross-clause guard)', () => {
          // Both clauses target HttpException; their value substrings are
          // disjoint. This guards against a future refactor that loosens
          // one regex into the other's territory.
          const noSnapshot = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'HttpException',
                  value: "{ error: 'no_snapshot_yet' }",
                },
              ],
            },
          });
          const concurrent = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'HttpException',
                  value: 'status changed concurrently',
                },
              ],
            },
          });
          // Both drop, but via different clauses — assert both null without
          // either regex matching the other's substring.
          expect(noSnapshot).toBeNull();
          expect(concurrent).toBeNull();
        });
      });

      describe('ROK-1162: AbortError drop', () => {
        it('drops AbortError typed events', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                { type: 'AbortError', value: 'The operation was aborted' },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops DOMException whose value mentions abort', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DOMException',
                  value: 'The user aborted a request.',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('does NOT drop unrelated DOMException events', () => {
          const event: SentryEvent = {
            exception: {
              values: [{ type: 'DOMException', value: 'QuotaExceededError' }],
            },
          };
          expect(getBeforeSend()(event)).toBe(event);
        });
      });

      describe('ROK-1162: DiscordAPIError transient fingerprint', () => {
        it('fingerprints DiscordAPIError 5xx events', () => {
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value: 'Internal Server Error (HTTP 503)',
                },
              ],
            },
          };
          const result = getBeforeSend()(event) as SentryEvent;
          expect(result).toBe(event);
          expect(result.fingerprint).toEqual(['discord-api-transient']);
        });

        it('fingerprints DiscordAPIError network failures (ECONNRESET)', () => {
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value: 'fetch failed: ECONNRESET',
                },
              ],
            },
          };
          const result = getBeforeSend()(event) as SentryEvent;
          expect(result.fingerprint).toEqual(['discord-api-transient']);
        });

        it('does NOT fingerprint non-transient DiscordAPIError events', () => {
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value: 'Unknown Channel (code 10003)',
                },
              ],
            },
          };
          const result = getBeforeSend()(event) as SentryEvent;
          expect(result).toBe(event);
          expect(result.fingerprint).toBeUndefined();
        });

        it('does NOT fingerprint Discord permission/access codes that start with 500x (regex word-boundary regression guard)', () => {
          // 50013 Missing Permissions, 50001 Missing Access — these are
          // PERMANENT permission failures, NOT transient 5xx HTTP. Without
          // \b boundaries on /5\d\d/, the regex would match "500" inside
          // "50013" and mis-group these as discord-api-transient.
          const missingPermissions: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value: 'Missing Permissions (code 50013)',
                },
              ],
            },
          };
          const missingAccess: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value: 'Missing Access (code 50001)',
                },
              ],
            },
          };
          expect(
            (getBeforeSend()(missingPermissions) as SentryEvent).fingerprint,
          ).toBeUndefined();
          expect(
            (getBeforeSend()(missingAccess) as SentryEvent).fingerprint,
          ).toBeUndefined();
        });

        // ── ROK-1354: bracketed type must still reach the fingerprint block ──
        //
        // The ROK-1162 transient-fingerprint block shares the same dead
        // `=== 'DiscordAPIError'` comparison. With production's bracketed
        // type, it never fired. After the `startsWith` fix, a transient 5xx
        // carrying the bracketed type must still get the shared fingerprint.
        it('fingerprints bracketed DiscordAPIError[503] transient 5xx (ROK-1354)', () => {
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError[503]',
                  value: 'Internal Server Error (HTTP 503)',
                },
              ],
            },
          };
          const result = getBeforeSend()(event) as SentryEvent;
          expect(result).toBe(event);
          expect(result.fingerprint).toEqual(['discord-api-transient']);
        });

        it('fingerprints bracketed DiscordAPIError network failures (ECONNRESET, ROK-1354)', () => {
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError[0]',
                  value: 'fetch failed: ECONNRESET',
                },
              ],
            },
          };
          const result = getBeforeSend()(event) as SentryEvent;
          expect(result.fingerprint).toEqual(['discord-api-transient']);
        });

        it('does NOT fingerprint bracketed permanent codes like [50013] (word-boundary regression guard, ROK-1354)', () => {
          // 50013 Missing Permissions / 50001 Missing Access are PERMANENT.
          // The bracketed type `DiscordAPIError[50013]` must NOT regress into
          // the transient grouping: neither the value `\b5\d\d\b` nor the new
          // `Unknown User|code 10013` additions may collide with these.
          const missingPermissions: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError[50013]',
                  value: 'Missing Permissions (code 50013)',
                },
              ],
            },
          };
          const missingAccess: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'DiscordAPIError[50001]',
                  value: 'Missing Access (code 50001)',
                },
              ],
            },
          };
          expect(
            (getBeforeSend()(missingPermissions) as SentryEvent).fingerprint,
          ).toBeUndefined();
          expect(
            (getBeforeSend()(missingAccess) as SentryEvent).fingerprint,
          ).toBeUndefined();
        });

        it('drops bracketed [50278] ahead of fingerprinting when both would match (clause ordering, ROK-1354)', () => {
          // Bracketed-type variant of the existing clause-ordering guard: a
          // bracketed DiscordAPIError carrying BOTH "code 50278" AND a
          // transient substring must drop on the 50278 clause, never reaching
          // the fingerprint clause.
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError[50278]',
                  value:
                    'Cannot send messages to this user (code 50278) — fetch failed',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops 50278 ahead of fingerprinting when both regexes would match (clause ordering guard)', () => {
          // A DiscordAPIError carrying BOTH "code 50278" AND a transient
          // substring ("fetch failed") must drop on the 50278 clause and
          // never reach the fingerprint clause. This regression-guards the
          // ordering of the two clauses.
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'DiscordAPIError',
                  value:
                    'Cannot send messages to this user (code 50278) — fetch failed',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });
      });

      // ── ROK-1307: drop Steam-sync 4xx noise ──
      //
      // Manual `POST /auth/steam/sync` and `/auth/steam/sync-wishlist` raise
      // BadRequestException / ServiceUnavailableException for user-fixable
      // states (unlinked Steam, private profile, missing API key). These are
      // expected 4xx responses, NOT Sentry-worthy bugs. The filter drops the
      // four canonical messages by regex; the load-bearing case is the
      // `BadRequestException: Steam account not linked` burst that motivated
      // the story. Mirrors the `no_snapshot_yet` / `status changed concurrently`
      // shape — match on `exception.values[0].value`, not on type, so legacy
      // bare `Error` payloads still under cron paths are also caught.
      describe('ROK-1307: Steam-sync 4xx drop', () => {
        it('drops BadRequestException: "Steam account not linked"', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'BadRequestException',
                  value: 'Steam account not linked',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops legacy bare Error: "User has no linked Steam account"', () => {
          // Cron paths still throw the pre-AC-1 bare message. The regex MUST
          // catch this spelling too — it is the literal text from the Sentry
          // burst that prompted ROK-1307.
          const result = getBeforeSend()({
            exception: {
              values: [
                { type: 'Error', value: 'User has no linked Steam account' },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops BadRequestException: "Steam profile is private — …"', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'BadRequestException',
                  value:
                    'Steam profile is private — set Game Details to Public in your Steam Privacy Settings, then try again',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('does NOT drop "Steam integration is not configured" (Codex fix: ops signal, not user-fixable)', () => {
          // ServiceUnavailableException for missing API key is an admin/ops
          // problem — admin needs to set the Steam API key in app_settings.
          // It MUST reach Sentry so ops sees it. Codex review of ROK-1307
          // caught this filter regression.
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'ServiceUnavailableException',
                  value: 'Steam integration is not configured',
                },
              ],
            },
          };
          expect(getBeforeSend()(event)).toBe(event);
        });

        it('does NOT drop unrelated Steam-themed exceptions', () => {
          // A real Steam-side outage that DOES warrant Sentry attention must
          // pass through unchanged — only the four canonical user-fixable
          // strings are filtered.
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'Error',
                  value:
                    'Steam API returned HTTP 503 from GetOwnedGames — retrying',
                },
              ],
            },
          };
          expect(getBeforeSend()(event)).toBe(event);
        });
      });

      // ── ROK-1328: drop cron_jobs FK violations (23503) ──
      //
      // The primary fix self-heals CronJobService.jobCache so a stale cached
      // job.id no longer re-throws the FK on every cron tick (~2 events/min,
      // 1348 in 11h). This beforeSend branch is the second line of defense —
      // if any path ever re-throws the FK error, Sentry MUST still drop it.
      // Match on the constraint name embedded in the VALUE, not the type, since
      // the error reaches Sentry as a bare Error/PostgresError from cron paths.
      describe('ROK-1328: cron_job_executions FK drop', () => {
        it('drops events whose value contains the FK constraint name', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'Error',
                  value:
                    'insert or update on table "cron_job_executions" violates ' +
                    'foreign key constraint ' +
                    '"cron_job_executions_cron_job_id_fkey"',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('drops the FK error regardless of exception type', () => {
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'PostgresError',
                  value:
                    'Key (cron_job_id)=(42) is not present in table ' +
                    '"cron_jobs" — cron_job_executions_cron_job_id_fkey',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });

        it('does NOT drop unrelated FK violations on other tables', () => {
          // A different constraint name (e.g. a real data-integrity bug
          // elsewhere) must still reach Sentry.
          const event: SentryEvent = {
            exception: {
              values: [
                {
                  type: 'Error',
                  value:
                    'insert or update violates foreign key constraint ' +
                    '"signups_event_id_fkey"',
                },
              ],
            },
          };
          expect(getBeforeSend()(event)).toBe(event);
        });
      });

      describe('ROK-1162: malformed OAuth state (already covered by ROK-668)', () => {
        it('drops InternalOAuthError whose value indicates a state mismatch', () => {
          // The ROK-668 filter already drops by type alone, so any value
          // (including malformed/missing state) is suppressed. This is a
          // regression guard for the noise class named in ROK-1162.
          const result = getBeforeSend()({
            exception: {
              values: [
                {
                  type: 'InternalOAuthError',
                  value:
                    'InternalOAuthError: Failed to obtain access token (state mismatch)',
                },
              ],
            },
          });
          expect(result).toBeNull();
        });
      });
    });
  });

  describe('when DISABLE_TELEMETRY=true', () => {
    let sentryInitMock: jest.MockedFunction<
      (options?: Record<string, unknown>) => void
    >;

    beforeEach(async () => {
      ({ sentryInitMock } = await loadInstrument({
        DISABLE_TELEMETRY: 'true',
      }));
    });

    it('does NOT call Sentry.init', () => {
      expect(sentryInitMock).not.toHaveBeenCalled();
    });
  });

  describe('when DISABLE_TELEMETRY is not set (but not production)', () => {
    let sentryInitMock: jest.MockedFunction<
      (options?: Record<string, unknown>) => void
    >;

    beforeEach(async () => {
      ({ sentryInitMock } = await loadInstrument({
        DISABLE_TELEMETRY: undefined,
      }));
    });

    it('does NOT call Sentry.init (production-only)', () => {
      expect(sentryInitMock).not.toHaveBeenCalled();
    });
  });
}
describe('Sentry instrument.ts', () => describeSentryInstrumentTs());
