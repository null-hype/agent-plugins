import { readFileSync } from 'node:fs';
import { runImageClaims } from '../src/lib/imageClaims.ts';
const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('Usage: npm run image-claims -- <file> [file ...]');
  process.exitCode = 2;
} else {
  try {
    const result = runImageClaims(paths.map(path => ({ path, bytes: readFileSync(path) })));
    console.log(result.raw);
    console.log('No finding is not a safety verdict. These checks do not validate full image contents.');
    process.exitCode = result.findings.length ? 1 : 0;
  } catch (error) {
    console.error(String(error)); process.exitCode = 2;
  }
}
