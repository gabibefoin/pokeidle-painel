// Entrypoint. ROLE decide o que este processo é:
//   all      gateway + simulação juntos (dev, e suficiente até ~500 jogadores)
//   gateway  só WebSocket + estáticos  (escala com o número de sockets)
//   sim      só simulação de um shard  (escala com o número de jogadores)
import { config, ehGateway, ehSim } from './config.mjs';
import { conectarBus } from './bus.mjs';
import { iniciarSim, abortarBootDoSim } from './sim.mjs';
import { iniciarGateway } from './gateway.mjs';

console.log(`[boot] role=${config.role} shard=${config.shardId}/${config.shardCount} pid=${process.pid}`);

await conectarBus();
if (ehSim) {
  try {
    await iniciarSim();
  } catch (err) {
    await abortarBootDoSim().catch(() => {});
    throw err;
  }
}
if (ehGateway) await iniciarGateway();

process.on('unhandledRejection', (err) => console.error('[boot] rejeição não tratada:', err));
