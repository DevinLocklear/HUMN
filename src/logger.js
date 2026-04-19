"use strict";

const { DEBUG } = require("./config");

/**
 * Returns a logger bound to a specific context label.
 * All output includes an ISO timestamp and the context tag.
 *
 * Usage:
 *   const log = require('./logger').createLogger('yahoo');
 *   log.info('New messages', { count: 3, email: 'user@yahoo.com' });
 *   log.error('IMAP connect failed', err);
 *   log.debug('Raw envelope', envelope);   // only fires when DEBUG=true
 */

function timestamp() {
  return new Date().toISOString();
}

function formatMeta(meta) {
  if (!meta) return "";
  if (meta instanceof Error) return ` — ${meta.message}`;
  if (typeof meta === "object") {
    try {
      return " " + JSON.stringify(meta);
    } catch {
      return " [unserializable]";
    }
  }
  return ` ${String(meta)}`;
}

function createLogger(context) {
  const tag = `[${context}]`;

  return {
    info(message, meta) {
      console.log(`${timestamp()} INFO  ${tag} ${message}${formatMeta(meta)}`);
    },

    warn(message, meta) {
      console.warn(`${timestamp()} WARN  ${tag} ${message}${formatMeta(meta)}`);
    },

    error(message, meta) {
      console.error(
        `${timestamp()} ERROR ${tag} ${message}${formatMeta(meta)}`
      );
    },

    debug(message, meta) {
      if (DEBUG) {
        console.log(
          `${timestamp()} DEBUG ${tag} ${message}${formatMeta(meta)}`
        );
      }
    },
  };
}

// Convenience: a root logger for top-level messages
const rootLogger = createLogger("humn");

module.exports = { createLogger, log: rootLogger };
