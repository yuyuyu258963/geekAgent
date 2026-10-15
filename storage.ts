import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SESSION_FILE } from "./config";
import type { SessionData } from './sessions';
import {  } from "node:fs";


export async function saveSessions(data: SessionData): Promise<string> {
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, 
          JSON.stringify(data, null, 2) + '\n', 'utf8');
  return SESSION_FILE;
}

export async function loadSessions(): Promise<{ data: unknown; file: string }> {
  return {
    data: JSON.parse( await readFile(SESSION_FILE, 'utf8')),
    file: SESSION_FILE
  }
}