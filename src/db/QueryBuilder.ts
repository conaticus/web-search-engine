import { QueryResult } from "pg";
import pool from "./pool";

// Ideally this class would execute all commands in one query, but pg prohibits this, in future could use: https://www.npmjs.com/package/pg-promise
export default class QueryBuilder {
    public static async insert(table: string, columns: string[], values: any[]) {
        const parametisedColumns = columns.map((_, idx) => `$${idx + 1}`);

        const query = `INSERT INTO ${table} (${columns.join()}) VALUES (${parametisedColumns.join()})`;
        await QueryBuilder.query(query, values);
    }

    public static async insertManyOrUpdate(
        table: string,
        columns: string[],
        values: any[][],
        types: string[],
        conflictColumns: string[],
        conflictAction: string,
        returns: string[] = []
    ): Promise<QueryResult<any>> {
        const parametisedColumns = columns.map(
            (_, idx) => `unnest($${idx + 1}::${types[idx]}[]) as ${columns[idx]}`
        );

        let query = `INSERT INTO ${table} (${columns.join()}) SELECT ${parametisedColumns.join()} ON CONFLICT (${conflictColumns.join()}) DO UPDATE SET ${conflictAction}`;
        if (returns.length != 0) query += ` RETURNING ${returns.join()}`;

        return (await QueryBuilder.query(query, values)) as any;
    }

    public static async insertMany(
        table: string,
        columns: string[],
        values: any[][],
        types: string[]
    ) {
        const parametisedColumns = columns.map(
            (_, idx) => `unnest($${idx + 1}::${types[idx]}[]) as ${columns[idx]}`
        );

        const query = `INSERT INTO ${table} (${columns.join()}) SELECT ${parametisedColumns.join()}`;

        await QueryBuilder.query(query, values);
    }

    public static async query(query: string, data: any): Promise<QueryResult<any> | undefined> {
        try {
            return await pool.query(query, data);
        } catch (e) {
            console.log(`[WARNING]: Query failed - ${e}`);
        }
    }
}
