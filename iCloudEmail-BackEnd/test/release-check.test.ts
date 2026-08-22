import assert from 'node:assert/strict';
import test from 'node:test';
import { isNewerVersion } from '../../iCloudEmail-FrontEnd/src/releaseCheck.js';

test('release comparison handles tags and missing version components', () => {
  assert.equal(isNewerVersion('v0.2.0', '0.1.0'), true);
  assert.equal(isNewerVersion('1.0', '0.9.9'), true);
  assert.equal(isNewerVersion('0.1.0', '0.1.0'), false);
  assert.equal(isNewerVersion('0.1.0', '0.2.0'), false);
  assert.equal(isNewerVersion('not-a-version', '0.1.0'), false);
});
