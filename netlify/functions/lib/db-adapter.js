/**
 * D1 Database Adapter for Netlify
 *
 * This module provides a compatibility layer that implements the Cloudflare D1
 * database API on top of Turso (libSQL). The original EWS functions use D1's
 * fluent interface:
 *
 *   const db = env.EWS_NOTIFY_DB;
 *   db.prepare(sql).bind(...params).run()   → { meta: { changes } }
 *   db.prepare(sql).bind(...params).all()   → { results: [...rows] }
 *   db.prepare(sql).bind(...params).first() → row | null
 *
 * This adapter wraps @libsql/client to expose the same API surface.
 *
 * Usage:
 *   import { createD1Adapter } from "./lib/db-adapter.js";
 *   const db = createD1Adapter(process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN);
 *   env.EWS_NOTIFY_DB = db;
 */

import { createClient } from "@libsql/client";

/**
 * Creates a D1-compatible database adapter backed by Turso/libSQL.
 *
 * @param {string} url - Turso database URL (e.g. libsql://your-db.turso.io)
 * @param {string} authToken - Turso authentication token
 * @returns {object} D1-compatible database interface
 */
export function createD1Adapter(url, authToken) {
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is required for the database adapter.");
  }

  const client = createClient({
    url,
    authToken: authToken || undefined,
  });

  return {
    /**
     * Prepare a SQL statement (D1 .prepare() equivalent)
     * @param {string} sql
     * @returns {D1PreparedStatement}
     */
    prepare(sql) {
      return new D1PreparedStatement(client, sql);
    },

    /**
     * Execute a batch of statements in a transaction
     * @param {D1PreparedStatement[]} statements
     * @returns {Promise<object[]>}
     */
    async batch(statements) {
      const results = [];
      // libSQL supports transactions; execute each statement sequentially
      const transaction = await client.transaction("write");
      try {
        for (const stmt of statements) {
          const result = await transaction.execute({
            sql: stmt._sql,
            args: stmt._params,
          });
          results.push({
            results: result.rows,
            meta: {
              changes: result.rowsAffected,
              last_row_id: result.lastInsertRowid,
              duration: 0,
            },
          });
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      return results;
    },

    /**
     * Execute raw SQL (for simple queries)
     * @param {string} sql
     * @returns {Promise<object>}
     */
    async exec(sql) {
      const result = await client.execute(sql);
      return {
        count: result.rowsAffected,
        duration: 0,
      };
    },
  };
}

/**
 * Implements D1's PreparedStatement interface.
 */
class D1PreparedStatement {
  constructor(client, sql) {
    this._client = client;
    this._sql = sql;
    this._params = [];
  }

  /**
   * Bind parameters to the prepared statement (D1 .bind() equivalent)
   * @param  {...any} params - Positional parameters matching ? placeholders
   * @returns {D1PreparedStatement}
   */
  bind(...params) {
    // D1 uses positional params. libSQL also supports positional params as an array.
    // Normalize null/undefined values and convert booleans.
    this._params = params.map((param) => {
      if (param === undefined) return null;
      if (typeof param === "boolean") return param ? 1 : 0;
      return param;
    });
    return this;
  }

  /**
   * Execute the statement and return metadata (D1 .run() equivalent)
   * Used for INSERT, UPDATE, DELETE statements.
   * @returns {Promise<{meta: {changes: number, last_row_id: number|bigint, duration: number}}>}
   */
  async run() {
    const result = await this._client.execute({
      sql: this._sql,
      args: this._params,
    });

    return {
      meta: {
        changes: result.rowsAffected,
        last_row_id: result.lastInsertRowid,
        duration: 0,
      },
      success: true,
    };
  }

  /**
   * Execute the statement and return all rows (D1 .all() equivalent)
   * @returns {Promise<{results: object[], meta: {changes: number}}>}
   */
  async all() {
    const result = await this._client.execute({
      sql: this._sql,
      args: this._params,
    });

    return {
      results: result.rows || [],
      meta: {
        changes: result.rowsAffected,
        last_row_id: result.lastInsertRowid,
        duration: 0,
      },
      success: true,
    };
  }

  /**
   * Execute the statement and return the first row (D1 .first() equivalent)
   * @param {string|null} column - Optional column name to return just that value
   * @returns {Promise<object|null>}
   */
  async first(column = null) {
    const result = await this._client.execute({
      sql: this._sql,
      args: this._params,
    });

    const firstRow = result.rows?.[0] || null;
    if (!firstRow) return null;
    if (column) return firstRow[column] ?? null;
    return firstRow;
  }

  /**
   * Execute the statement and return raw results (D1 .raw() equivalent)
   * @returns {Promise<Array<Array>>}
   */
  async raw() {
    const result = await this._client.execute({
      sql: this._sql,
      args: this._params,
    });

    if (!result.rows?.length) return [];

    // Convert row objects to arrays of values
    return result.rows.map((row) => Object.values(row));
  }
}

export default createD1Adapter;
