// Registra uma grade de arena por boss — recorte da hunt-fonte sorteada por tipo.
import { parCombateNaGrade } from '../../shared/bosses-mapas.mjs';
import { BOSSES } from './bosses.mjs';

let feito = false;

/** Uma vez no boot do sim — muta `grades` de content.mjs. */
export function registrarArenasBosses(grades) {
  if (feito) return;
  feito = true;

  let ok = 0;
  let falha = 0;

  for (const boss of Object.values(BOSSES)) {
    const fonte = boss.mapaFonte;
    const bruta = grades[fonte];
    if (!bruta?.grid?.length || !bruta.pontos?.length) {
      console.warn(`[bosses] arena ${boss.key}: fonte "${fonte}" sem grade — pulando`);
      falha++;
      continue;
    }

    const { inicio, boss: bp } = parCombateNaGrade(bruta);
    grades[boss.arena] = {
      mapa: bruta.mapa ?? fonte,
      box: bruta.box,
      groundZ: bruta.groundZ,
      center: bruta.center,
      inicio,
      andaveis: bruta.andaveis,
      pontos: [[bp[0], bp[1], boss.pokeId]],
      grid: bruta.grid,
    };
    ok++;
  }

  console.log(`[bosses] ${ok} arenas registradas (${falha} sem fonte)`);
}
