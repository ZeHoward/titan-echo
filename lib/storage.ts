import { env } from 'cloudflare:workers';
export function database(){if(!env.DB)throw Error('Cloud storage is unavailable');return env.DB;}
