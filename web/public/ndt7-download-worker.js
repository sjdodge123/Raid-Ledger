/*
 * VENDORED — verbatim copy of @m-lab/ndt7@0.1.5 src/ndt7-download-worker.js.
 * Copyright Measurement Lab. Licensed under the Apache License, Version 2.0:
 * https://github.com/m-lab/ndt7-js/blob/main/LICENSE
 *
 * ndt7 builds its download worker with
 *   `new Worker(config.downloadworkerfile || 'ndt7-download-worker.js')`
 * — a PAGE-relative url. The app is a SPA served from arbitrary routes, so that
 * default resolves to a 404 (or to index.html) and no measurement can ever
 * start. Serving the worker from `public/` gives it one stable absolute url;
 * `web/src/lib/speedtest/ndt7-load.ts` hands that url to the library.
 *
 * Bundling it via `?url` instead was tried and rejected: the file is under
 * Vite's inline limit, so it came out as a `data:text/javascript` url, and
 * workers from data urls are refused by some browsers.
 *
 * DO NOT EDIT — everything below the header is byte-identical to the package
 * file, and `ndt7-runner.test.ts` fails if it drifts. Re-copy on upgrade.
 */
// workerMain is the WebWorker function that runs the ndt7 download test.
const workerMain = function(ev) {
  'use strict';
  const url = ev.data['///ndt/v7/download'];
  const sock = new WebSocket(url, 'net.measurementlab.ndt.v7');
  let now;
  if (typeof performance !== 'undefined' &&
      typeof performance.now === 'function') {
    now = () => performance.now();
  } else {
    now = () => Date.now();
  }
  downloadTest(sock, postMessage, now);
};

/**
 * downloadTest is a function that runs an ndt7 download test using the
 * passed-in websocket instance and the passed-in callback function.  The
 * socket and callback are passed in to enable testing and mocking.
 *
 * @param {WebSocket} sock - The WebSocket being read.
 * @param {function} postMessage - A function for messages to the main thread.
 * @param {function} now - A function returning a time in milliseconds.
 */
const downloadTest = function(sock, postMessage, now) {
  sock.onclose = function() {
    postMessage({
      MsgType: 'complete',
    });
  };

  sock.onerror = function(ev) {
    postMessage({
      MsgType: 'error',
      Error: ev.type,
    });
  };

  let start = now();
  let previous = start;
  let total = 0;

  sock.onopen = function() {
    start = now();
    previous = start;
    total = 0;
    postMessage({
      MsgType: 'start',
      Data: {
        ClientStartTime: start,
      },
    });
  };

  sock.onmessage = function(ev) {
    total +=
        (typeof ev.data.size !== 'undefined') ? ev.data.size : ev.data.length;
    // Perform a client-side measurement 4 times per second.
    const t = now();
    const every = 250; // ms
    if (t - previous > every) {
      postMessage({
        MsgType: 'measurement',
        ClientData: {
          ElapsedTime: (t - start) / 1000, // seconds
          NumBytes: total,
          // MeanClientMbps is calculated via the logic:
          //  (bytes) * (bits / byte) * (megabits / bit) = Megabits
          //  (Megabits) * (1/milliseconds) * (milliseconds / second) = Mbps
          // Collect the conversion constants, we find it is 8*1000/1000000
          // When we simplify we get: 8*1000/1000000 = .008
          MeanClientMbps: (total / (t - start)) * 0.008,
        },
        Source: 'client',
      });
      previous = t;
    }

    // Pass along every server-side measurement.
    if (typeof ev.data === 'string') {
      postMessage({
        MsgType: 'measurement',
        ServerMessage: ev.data,
        Source: 'server',
      });
    }
  };
};

// Node and browsers get onmessage defined differently.
if (typeof self !== 'undefined') {
  self.onmessage = workerMain;
} else if (typeof this !== 'undefined') {
  this.onmessage = workerMain;
} else if (typeof onmessage !== 'undefined') {
  onmessage = workerMain;
}
