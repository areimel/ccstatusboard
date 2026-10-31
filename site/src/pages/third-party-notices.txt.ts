// Emits /third-party-notices.txt at build time so the deployed site carries the
// template and font licences (the source files under src/ never reach dist/).
import type { APIRoute } from 'astro';
import notices from '../../THIRD_PARTY_NOTICES.md?raw';
import dmSans from '../assets/fonts/DMSans-OFL.txt?raw';
import jetbrainsMono from '../assets/fonts/JetBrainsMono-OFL.txt?raw';
import dejaVu from '../assets/fonts/DejaVu-LICENSE.txt?raw';

export const GET: APIRoute = () => {
  const body = [notices, dmSans, jetbrainsMono, dejaVu]
    .map((s) => s.trim())
    .join('\n\n' + '-'.repeat(72) + '\n\n');
  return new Response(body + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
