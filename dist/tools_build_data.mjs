import fs from 'node:fs';
import path from 'node:path';

const root = '/Users/gabilemos/Documents/Pokeidle/PokeidleHub';
const csvPath = path.join(root, 'pokedex-completa-excel.csv');
const outJsonPath = path.join(root, 'portal/data/pokedex_portal.json');

console.log('🔄 Lendo pokedex-completa-excel.csv para compilar dados oficiais...');
const csvRaw = fs.readFileSync(csvPath, 'utf8');

function parseDrops(dropsStr) {
  if (!dropsStr) return [];
  const list = [];
  for (const chunk of dropsStr.split('|')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(.*?)\s+([\d\.]+)%\s+x([\d\-]+)(?:\s+\((.*?)\))?$/);
    if (m) {
      const name = m[1].trim();
      const pct = parseFloat(m[2]);
      const qtd = m[3].trim();
      const note = m[4] ? m[4].trim() : '';
      list.push({
        name,
        pct,
        qtd,
        note,
        raw: trimmed
      });
    } else {
      list.push({
        name: trimmed,
        pct: 0,
        qtd: '1',
        note: '',
        raw: trimmed
      });
    }
  }
  return list;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  if (!lines.length) return [];
  
  let headerLine = lines[0];
  if (headerLine.charCodeAt(0) === 0xFEFF) {
    headerLine = headerLine.slice(1);
  }
  const headers = headerLine.split(';').map(h => h.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = line.split(';');
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (parts[j] || '').trim();
    }

    // 1. Processamento de Hunt Tag
    const onde = row.onde_encontrar || '';
    const aparece = (row.aparece_em_hunt || '').toLowerCase();
    if (aparece === 'nao' || onde.toLowerCase().includes('não aparece') || onde.toLowerCase().includes('sem arena')) {
      row.hunt_tag = 'sem hunt no mapa hoje';
      row.is_cacavel = false;
    } else {
      const match = onde.match(/^([^,(]+)\s*\(Nv\s*([\d\.]+)/);
      if (match) {
        row.hunt_tag = `${match[1].trim()} Nv${match[2].replace(/\./g, '')}`;
        row.is_cacavel = true;
      } else {
        row.hunt_tag = 'sem hunt no mapa hoje';
      }
    }

    // Ignorar bosses e Pokémon sem hunt no mapa de todas as tabelas
    if (!row.is_cacavel || row.hunt_tag === 'sem hunt no mapa hoje') {
      continue;
    }

    // 2. Fraquezas e Resistências
    const fraco = row.fraco_contra || '';
    const resiste = row.resiste_a || '';
    
    row.f4_types = fraco.split('|')
      .filter(p => p.includes('x4'))
      .map(p => p.trim().split(' ')[0])
      .filter(Boolean);

    row.f2_types = fraco.split('|')
      .filter(p => p.includes('x2'))
      .map(p => p.trim().split(' ')[0])
      .filter(Boolean);

    row.r05_types = resiste.split('|')
      .filter(p => p.includes('x0.5'))
      .map(p => p.trim().split(' ')[0])
      .filter(Boolean);

    row.r025_types = resiste.split('|')
      .filter(p => p.includes('x0.25'))
      .map(p => p.trim().split(' ')[0])
      .filter(Boolean);

    row.imune_types = resiste.split('|')
      .filter(p => p.includes('x0') && !p.includes('x0.'))
      .map(p => p.trim().split(' ')[0])
      .filter(Boolean);

    // 3. Drops estruturados
    row.drops_parsed = parseDrops(row.drops);
    row.item_names = row.drops_parsed.map(d => d.name);

    // 4. Valores numéricos para filtros e ordenação
    row.hunt_lvl_min = parseInt(row.nivel_hunt_min, 10) || 0;
    row.hunt_lvl_max = parseInt(row.nivel_hunt_max, 10) || 0;
    row.xp_base = parseInt(row.xp_por_derrota, 10) || 0;
    row.xp_boosted = Math.round(row.xp_base * 1.5);
    row.price_npc_num = parseInt(row.price_npc, 10) || 0;
    row.bst_num = parseInt(row.total_stats, 10) || 0;
    row.hp_num = parseInt(row.hp, 10) || 0;
    row.atk_num = parseInt(row.atk, 10) || 0;
    row.def_num = parseInt(row.def, 10) || 0;
    row.spatk_num = parseInt(row.spatk, 10) || 0;
    row.spdef_num = parseInt(row.spdef, 10) || 0;
    row.spd_num = parseInt(row.spd, 10) || 0;
    row.qtd_golpes_num = parseInt(row.qtd_golpes, 10) || 0;
    row.estagio_num = parseInt(row.estagio_evolutivo, 10) || 1;

    rows.push(row);
  }
  return rows;
}

const records = parseCsv(csvRaw);
console.log(`✅ Total de espécies processadas: ${records.length}`);

fs.writeFileSync(outJsonPath, JSON.stringify(records, null, 2), 'utf8');
console.log(`🎉 Salvo com sucesso em: ${outJsonPath}`);
