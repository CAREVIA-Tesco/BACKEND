import dns from 'node:dns';
import mongoose from 'mongoose';

// "mongodb+srv://" addresses need a DNS SRV lookup. On many Windows PCs / home routers that
// lookup fails inside Node.js ("querySrv ECONNREFUSED"), so we ask public DNS servers instead.
// Override with DNS_SERVERS in .env (comma separated), or set DNS_SERVERS=system to keep the PC's DNS.
function useReliableDns(uri) {
  if (!uri.startsWith('mongodb+srv://')) return;
  const setting = (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1').trim();
  if (setting.toLowerCase() === 'system') return;
  const servers = setting.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    dns.setServers(servers);
  } catch (err) {
    console.warn('[MongoDB] Could not set DNS servers:', err.message);
  }
}

export async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/carevia';
  mongoose.set('strictQuery', true);
  useReliableDns(uri);
  try {
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    console.error('\n[MongoDB] Could not connect to', uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@'));
    console.error('[MongoDB]', err.message);
    if (/querySrv|ENOTFOUND|ECONNREFUSED/.test(err.message) && uri.startsWith('mongodb+srv://')) {
      console.error('[MongoDB] DNS lookup for the Atlas cluster failed. Check your internet connection, or try another network (e.g. mobile hotspot).');
    } else if (/timed out|Server selection/i.test(err.message)) {
      console.error('[MongoDB] Atlas did not respond. In Atlas → Security → Network Access, add your current IP address (or 0.0.0.0/0).');
    } else if (/auth/i.test(err.message)) {
      console.error('[MongoDB] Wrong database username or password in MONGO_URI.');
    } else {
      console.error('[MongoDB] Make sure MongoDB is running locally, or set MONGO_URI in Backend/.env to your MongoDB Atlas URL.');
    }
    throw err;
  }
}
