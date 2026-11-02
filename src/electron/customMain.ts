/** Set the profile before importing any module with startup-time path constants. */
import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CUSTOM_APP_NAME, CUSTOM_PROFILE_DIRECTORY } from './services/customProfile';

// dev:embedded passes --ozone-platform=x11 on the process command line.
// Selecting Ozone here is too late on some Electron/Linux builds.

app.setName(CUSTOM_APP_NAME);
const profile = path.join(app.getPath('appData'), CUSTOM_PROFILE_DIRECTORY);
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);

require('./main');
