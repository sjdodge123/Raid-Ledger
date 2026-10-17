# Pelican client-API fixtures (ROK-121)

Anonymised shapes of Pelican panel client-API responses, verified against
**pelican-dev/panel @ `b41ad3e528337c3b3943683b448eb11f2758d14f`** (`main`, read 2026-10-13).
No real hostnames, names, UUIDs, IPs or keys: UUIDs are fixed fake v4s, names are
"Example …", the IP is from the TEST-NET-1 documentation range (RFC 5737).

| Fixture | Built from |
|---|---|
| `servers-page.json` | `app/Http/Controllers/Api/Client/ClientController.php` (`index`, paginated) → `app/Data/Api/PanelResponse.php` (`toArray`, `meta.pagination`) → `app/Data/Api/Envelope.php` (`{object, attributes}`) with `app/Data/Api/Client/ServerData.php` attributes (subset; `sftp_details`, `limits`, etc. omitted). |
| `server-resources.json` | Copied verbatim from `tests/Integration/Api/Fixtures/Client/Server/__snapshots__/ResourceUtilizationFixtureTest__test_resources__1.json` (`app/Data/Api/Client/StatsData.php`). |
| `server-schedules.json` | `app/Data/Api/Client/ScheduleData.php` (`tasks` is a default include → `attributes.relationships.tasks = {object:'list', data:[…]}` via `IncludeContext::collection`) + `app/Data/Api/Client/TaskData.php`. Resource names: `Schedule::RESOURCE_NAME = 'server_schedule'`, `Task::RESOURCE_NAME = 'schedule_task'`. |
| `error-ip-not-allowed.json` | `app/Http/Middleware/Api/AuthenticateIPAccess.php` throws `AccessDeniedHttpException('This IP address (…) does not have permission to access the API using these credentials.')`, rendered by `app/Exceptions/Handler.php` as `{errors:[{code, status, detail}]}` with HTTP 403. |
