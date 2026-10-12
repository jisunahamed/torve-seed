import { homedir } from 'node:os';
import path from 'node:path';

export const TORVE_HOME_DIR = path.join(homedir(), '.torve');
export const CHAT_DATA_DIR = path.join(TORVE_HOME_DIR, 'chat');
export const CHAT_WORKSPACE_DIR = path.join(TORVE_HOME_DIR, 'projects');
