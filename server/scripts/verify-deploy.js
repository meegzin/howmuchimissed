const webUrl = process.argv[2] || 'https://howmuchimissed-web.onrender.com';
const apiUrl = process.argv[3] || 'https://howmuchimissed-api.onrender.com';
if (!process.env.SUPABASE_URL) throw new Error('Configure SUPABASE_URL no .env.');

const htmlResponse = await fetch(webUrl);
const html = await htmlResponse.text();
const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];
if (!assetPath) throw new Error('Bundle JavaScript não encontrado no frontend.');
const bundle = await (await fetch(new URL(assetPath, webUrl))).text();
console.log('Frontend publicado:', htmlResponse.ok ? 'OK' : `FALHOU (${htmlResponse.status})`);
console.log('API configurada no bundle:', bundle.includes(apiUrl) ? 'OK' : 'FALHOU');
console.log('Supabase configurado no bundle:', bundle.includes(new URL(process.env.SUPABASE_URL).hostname) ? 'OK' : 'FALHOU');
const health = await fetch(`${apiUrl}/api/health`, { headers: { Origin: webUrl } });
console.log('Health check:', health.ok ? 'OK' : `FALHOU (${health.status})`);
console.log('CORS frontend -> API:', health.headers.get('access-control-allow-origin') === webUrl ? 'OK' : 'FALHOU');
