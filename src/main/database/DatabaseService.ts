import { app } from "electron";
import Database from "better-sqlite3";
import { join } from "node:path";
import { applySchema } from "@main/database/schema";
import { Repositories } from "@main/database/repositories";

export class DatabaseService {
  private db: Database.Database;
  public readonly repositories: Repositories;

  constructor() {
    const dbPath = join(app.getPath("userData"), "kickr.sqlite");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    applySchema(this.db);
    this.repositories = new Repositories(this.db);
  }

  close(): void {
    this.db.close();
  }
}
