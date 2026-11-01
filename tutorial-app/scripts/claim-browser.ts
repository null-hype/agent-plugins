import { enhancePreregistration } from '../src/lib/claimMonaco';
const root = document.querySelector<HTMLElement>('[data-static-preregistration]');
if (root) enhancePreregistration(root);
