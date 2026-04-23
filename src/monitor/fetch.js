"use strict";

/**
 * src/monitor/fetch.js
 * Proxy-aware HTTP fetch using Node's native https/http modules.
 * No external dependencies required.
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");
const { createLogger } = require("../logger");

const log = createLogger("monitor:fetch");

/**
 * Make an HTTP request through a proxy (CONNECT tunnel for HTTPS)
 * @param {string} targetUrl - URL to fetch
 * @param {object} options - { headers, method, body, timeout }
 * @param {object} proxy - { host, port, user, pass }
 * @returns {Promise<{ status, headers, body }>}
 */
function proxyFetch(targetUrl, options = {}, proxy = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const isHttps = url.protocol === "https:";
    const targetPort = url.port || (isHttps ? 443 : 80);
    const timeout = options.timeout || 20000;

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json, text/html, */*",
      "Accept-Language": "en-US,en;q=0.9",
      ...(options.headers || {}),
    };

    if (options.body) {
      headers["Content-Length"] = Buffer.byteLength(options.body);
    }

    function makeDirectRequest() {
      const reqOptions = {
        hostname: url.hostname,
        port: targetPort,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers,
        timeout,
      };

      const req = (isHttps ? https : http).request(reqOptions, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });

      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
      if (options.body) req.write(options.body);
      req.end();
    }

    if (!proxy) {
      makeDirectRequest();
      return;
    }

    // Use HTTP CONNECT tunnel for HTTPS through proxy
    if (isHttps) {
      const proxyAuth = proxy.user && proxy.pass
        ? `Basic ${Buffer.from(`${proxy.user}:${proxy.pass}`).toString("base64")}`
        : null;

      const connectOptions = {
        hostname: proxy.host,
        port: proxy.port,
        method: "CONNECT",
        path: `${url.hostname}:${targetPort}`,
        headers: {
          "Host": `${url.hostname}:${targetPort}`,
          "Proxy-Connection": "Keep-Alive",
          ...(proxyAuth ? { "Proxy-Authorization": proxyAuth } : {}),
        },
      };

      const connectReq = http.request(connectOptions);
      const connectTimer = setTimeout(() => {
        connectReq.destroy();
        reject(new Error("Proxy connect timed out"));
      }, timeout);

      connectReq.on("error", (err) => {
        clearTimeout(connectTimer);
        reject(err);
      });

      connectReq.on("connect", (res, socket) => {
        clearTimeout(connectTimer);

        if (res.statusCode !== 200) {
          socket.destroy();
          reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
          return;
        }

        // Upgrade socket to TLS
        const tlsSocket = require("tls").connect({
          socket,
          servername: url.hostname,
          rejectUnauthorized: false,
        });

        tlsSocket.on("error", reject);

        tlsSocket.on("secureConnect", () => {
          const reqLines = [
            `${options.method || "GET"} ${url.pathname + url.search} HTTP/1.1`,
            `Host: ${url.hostname}`,
            ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
            "",
            "",
          ].join("\r\n");

          tlsSocket.write(reqLines);

          let rawData = "";
          tlsSocket.on("data", chunk => rawData += chunk.toString());
          tlsSocket.on("end", () => {
            const headerEnd = rawData.indexOf("\r\n\r\n");
            if (headerEnd === -1) { reject(new Error("Invalid HTTP response")); return; }
            const headerSection = rawData.slice(0, headerEnd);
            const body = rawData.slice(headerEnd + 4);
            const statusMatch = headerSection.match(/HTTP\/\d\.?\d? (\d+)/);
            const status = statusMatch ? parseInt(statusMatch[1]) : 0;
            resolve({ status, headers: {}, body });
          });
        });

        const reqTimer = setTimeout(() => {
          tlsSocket.destroy();
          reject(new Error("Request timed out"));
        }, timeout);

        tlsSocket.on("end", () => clearTimeout(reqTimer));
        tlsSocket.on("error", () => clearTimeout(reqTimer));
      });

      connectReq.end();
    } else {
      // HTTP through proxy — just set proxy as host
      const proxyAuth = proxy.user && proxy.pass
        ? `Basic ${Buffer.from(`${proxy.user}:${proxy.pass}`).toString("base64")}`
        : null;

      const reqOptions = {
        hostname: proxy.host,
        port: proxy.port,
        path: targetUrl,
        method: options.method || "GET",
        headers: {
          ...headers,
          "Host": url.hostname,
          ...(proxyAuth ? { "Proxy-Authorization": proxyAuth } : {}),
        },
        timeout,
      };

      const req = http.request(reqOptions, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });

      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
      if (options.body) req.write(options.body);
      req.end();
    }
  });
}

module.exports = { proxyFetch };
