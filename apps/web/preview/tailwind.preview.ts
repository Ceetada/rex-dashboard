import base from '../tailwind.config';
import type { Config } from 'tailwindcss';

/** Same theme as the app; content extended to include the preview markup. */
const config: Config = { ...base, content: ['./src/**/*.{ts,tsx}', './preview/*.html'] };
export default config;
