import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';

// Only the isolated debug macOS Editing QA binary recognizes this gate.
const root = '/private/tmp/komyaku-editing-qa-save-gate';
const action = process.argv[2] ?? 'status';
if (process.platform !== 'darwin') throw new Error('editing_qa_gate_requires_macos');
if (!['arm', 'release', 'status'].includes(action)) throw new Error('Use arm, release, or status');
const remove = async name => unlink(`${root}/${name}`).catch(error => {
  if (error.code !== 'ENOENT') throw error;
});
if (action === 'arm') {
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink()) throw new Error('editing_qa_gate_symlink');
  await remove('hold');
  await remove('ready.json');
  await writeFile(`${root}/hold`, '', { flag: 'wx' });
  console.log('Armed. Release within 60 seconds of the next QA save.');
} else if (action === 'release') {
  await remove('hold');
  console.log('Released.');
} else {
  const held = await lstat(`${root}/hold`).then(() => true).catch(error => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  const receipt = await readFile(`${root}/ready.json`, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  console.log(JSON.stringify({ held, receipt }));
}
