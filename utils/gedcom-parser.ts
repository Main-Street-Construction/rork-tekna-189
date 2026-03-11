import { GedcomIndividual, GedcomFamily, FamilyTreeData } from '@/types/genealogy';

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xFEFF) {
    return text.slice(1);
  }
  if (text.charCodeAt(0) === 0xEF && text.charCodeAt(1) === 0xBB && text.charCodeAt(2) === 0xBF) {
    return text.slice(3);
  }
  return text;
}

function extractXref(value: string): string {
  const match = value.match(/@([^@]+)@/);
  return match ? match[1] : value.replace(/@/g, '');
}

interface ParsedLine {
  level: number;
  xref: string;
  tag: string;
  value: string;
}

function parseLine(raw: string): ParsedLine | null {
  const line = raw.replace(/\r/g, '').trim();
  if (!line) return null;

  const match = line.match(/^(\d+)\s+(.*)$/);
  if (!match) {

    return null;
  }

  const level = parseInt(match[1], 10);
  let rest = match[2];

  let xref = '';
  const xrefMatch = rest.match(/^@([^@]+)@\s+(.*)$/);
  if (xrefMatch) {
    xref = xrefMatch[1];
    rest = xrefMatch[2];
  }

  const tagMatch = rest.match(/^(\S+)(?:\s+(.*))?$/);
  if (!tagMatch) {
    return null;
  }

  const tag = tagMatch[1].toUpperCase();
  const value = (tagMatch[2] || '').trim();

  return { level, xref, tag, value };
}

function cleanName(raw: string): { full: string; given: string; surname: string } {
  if (!raw || !raw.trim()) {
    return { full: 'Unknown', given: 'Unknown', surname: '' };
  }
  const surnameMatch = raw.match(/\/([^/]*)\//);
  const surname = surnameMatch ? surnameMatch[1].trim() : '';
  const given = raw.replace(/\/[^/]*\/?/g, '').trim();
  const full = surname ? `${given} ${surname}`.trim() : given;
  return { full: full || 'Unknown', given: given || 'Unknown', surname };
}

function collectSubLines(lines: ParsedLine[], startIndex: number, parentLevel: number): { subLines: ParsedLine[]; nextIndex: number } {
  const subLines: ParsedLine[] = [];
  let i = startIndex;
  while (i < lines.length && lines[i].level > parentLevel) {
    subLines.push(lines[i]);
    i++;
  }
  return { subLines, nextIndex: i };
}

function _getSubValue(subLines: ParsedLine[], tag: string): string | undefined {
  for (const line of subLines) {
    if (line.tag === tag) {
      return line.value;
    }
  }
  return undefined;
}

function buildConcatenatedValue(subLines: ParsedLine[], startIndex: number, baseLevel: number): { value: string; nextIndex: number } {
  let value = subLines[startIndex]?.value || '';
  let i = startIndex + 1;
  while (i < subLines.length && subLines[i].level > baseLevel) {
    const sl = subLines[i];
    if (sl.tag === 'CONT') {
      value += '\n' + sl.value;
    } else if (sl.tag === 'CONC') {
      value += sl.value;
    }
    i++;
  }
  return { value, nextIndex: i };
}

function parseEventSubLines(subLines: ParsedLine[]): { date?: string; place?: string } {
  let date: string | undefined;
  let place: string | undefined;

  for (const sl of subLines) {
    if (sl.tag === 'DATE' && !date) {
      date = sl.value;
    }
    if (sl.tag === 'PLAC' && !place) {
      place = sl.value;
    }
  }

  return { date, place };
}

export function parseGedcom(content: string): FamilyTreeData {
  console.log('[GEDCOM Parser] Starting parse...');

  const cleaned = stripBom(content);
  const rawLines = cleaned.split(/\r?\n|\r/);
  const parsedLines: ParsedLine[] = [];

  for (const raw of rawLines) {
    const parsed = parseLine(raw);
    if (parsed) parsedLines.push(parsed);
  }

  console.log(`[GEDCOM Parser] Parsed ${parsedLines.length} valid lines from ${rawLines.length} raw lines`);

  const individuals = new Map<string, GedcomIndividual>();
  const families = new Map<string, GedcomFamily>();

  let i = 0;
  while (i < parsedLines.length) {
    const line = parsedLines[i];

    if (line.level === 0 && line.tag === 'INDI' && line.xref) {
      const { subLines, nextIndex } = collectSubLines(parsedLines, i + 1, 0);

      const indi: GedcomIndividual = {
        id: line.xref,
        name: 'Unknown',
        givenName: 'Unknown',
        surname: '',
        sex: 'U',
        familiesAsSpouse: [],
      };

      let j = 0;
      while (j < subLines.length) {
        const sub = subLines[j];

        if (sub.tag === 'NAME' && sub.level === 1) {
          const names = cleanName(sub.value);
          indi.name = names.full;
          indi.givenName = names.given;
          indi.surname = names.surname;

          const { subLines: nameSubLines, nextIndex: nameNext } = collectSubLines(subLines, j + 1, 1);
          j = nameNext;

          for (const nsl of nameSubLines) {
            if (nsl.tag === 'GIVN' && nsl.value) indi.givenName = nsl.value;
            if (nsl.tag === 'SURN' && nsl.value) indi.surname = nsl.value;
            if (nsl.tag === '_MARNM' && nsl.value) {
              // married name - skip but don't crash
            }
          }

          if (indi.givenName !== 'Unknown' || indi.surname) {
            const reconstructed = indi.surname
              ? `${indi.givenName} ${indi.surname}`.trim()
              : indi.givenName;
            if (reconstructed) indi.name = reconstructed;
          }
          continue;
        }

        if (sub.tag === 'SEX' && sub.level === 1) {
          const val = sub.value.trim().toUpperCase();
          indi.sex = (val === 'M' || val === 'F') ? val : 'U';
          j++;
          continue;
        }

        if (sub.tag === 'BIRT' && sub.level === 1) {
          const { subLines: eventSub, nextIndex: eventNext } = collectSubLines(subLines, j + 1, 1);
          j = eventNext;
          const evt = parseEventSubLines(eventSub);
          if (evt.date) indi.birthDate = evt.date;
          if (evt.place) indi.birthPlace = evt.place;
          continue;
        }

        if (sub.tag === 'DEAT' && sub.level === 1) {
          const { subLines: eventSub, nextIndex: eventNext } = collectSubLines(subLines, j + 1, 1);
          j = eventNext;
          const evt = parseEventSubLines(eventSub);
          if (evt.date) indi.deathDate = evt.date;
          if (evt.place) indi.deathPlace = evt.place;
          continue;
        }

        if (sub.tag === 'BURI' && sub.level === 1) {
          const { nextIndex: eventNext } = collectSubLines(subLines, j + 1, 1);
          j = eventNext;
          continue;
        }

        if (sub.tag === 'CHR' && sub.level === 1) {
          const { nextIndex: eventNext } = collectSubLines(subLines, j + 1, 1);
          j = eventNext;
          continue;
        }

        if (sub.tag === 'BAPM' && sub.level === 1) {
          const { nextIndex: eventNext } = collectSubLines(subLines, j + 1, 1);
          j = eventNext;
          continue;
        }

        if (sub.tag === 'OCCU' && sub.level === 1) {
          indi.occupation = sub.value;
          const { nextIndex: occuNext } = collectSubLines(subLines, j + 1, 1);
          j = occuNext;
          continue;
        }

        if (sub.tag === 'NOTE' && sub.level === 1) {
          const { value: noteVal, nextIndex: noteNext } = buildConcatenatedValue(subLines, j, 1);
          indi.note = noteVal;
          j = noteNext;
          continue;
        }

        if (sub.tag === 'FAMS' && sub.level === 1) {
          const famRef = extractXref(sub.value);
          if (famRef) indi.familiesAsSpouse.push(famRef);
          j++;
          continue;
        }

        if (sub.tag === 'FAMC' && sub.level === 1) {
          const famRef = extractXref(sub.value);
          if (famRef) indi.familyAsChild = famRef;
          j++;
          continue;
        }

        if (sub.tag === 'RESI' && sub.level === 1) {
          const { nextIndex: resiNext } = collectSubLines(subLines, j + 1, 1);
          j = resiNext;
          continue;
        }

        if (sub.tag === 'EVEN' && sub.level === 1) {
          const { nextIndex: evenNext } = collectSubLines(subLines, j + 1, 1);
          j = evenNext;
          continue;
        }

        if (sub.tag === 'SOUR' && sub.level === 1) {
          const { nextIndex: sourNext } = collectSubLines(subLines, j + 1, 1);
          j = sourNext;
          continue;
        }

        if (sub.tag === 'OBJE' && sub.level === 1) {
          const { nextIndex: objeNext } = collectSubLines(subLines, j + 1, 1);
          j = objeNext;
          continue;
        }

        if (sub.tag === 'CHAN' && sub.level === 1) {
          const { nextIndex: chanNext } = collectSubLines(subLines, j + 1, 1);
          j = chanNext;
          continue;
        }

        const { nextIndex: skipNext } = collectSubLines(subLines, j + 1, sub.level);
        j = skipNext;
      }

      individuals.set(indi.id, indi);
      i = nextIndex;
      continue;
    }

    if (line.level === 0 && line.tag === 'FAM' && line.xref) {
      const { subLines, nextIndex } = collectSubLines(parsedLines, i + 1, 0);

      const fam: GedcomFamily = {
        id: line.xref,
        childrenIds: [],
      };

      let j = 0;
      while (j < subLines.length) {
        const sub = subLines[j];

        if (sub.tag === 'HUSB' && sub.level === 1) {
          fam.husbandId = extractXref(sub.value);
          j++;
          continue;
        }

        if (sub.tag === 'WIFE' && sub.level === 1) {
          fam.wifeId = extractXref(sub.value);
          j++;
          continue;
        }

        if (sub.tag === 'CHIL' && sub.level === 1) {
          const childRef = extractXref(sub.value);
          if (childRef) fam.childrenIds.push(childRef);
          j++;
          continue;
        }

        if (sub.tag === 'MARR' && sub.level === 1) {
          const { subLines: marrSub, nextIndex: marrNext } = collectSubLines(subLines, j + 1, 1);
          j = marrNext;
          const evt = parseEventSubLines(marrSub);
          if (evt.date) fam.marriageDate = evt.date;
          if (evt.place) fam.marriagePlace = evt.place;
          continue;
        }

        if (sub.tag === 'DIV' && sub.level === 1) {
          const { nextIndex: divNext } = collectSubLines(subLines, j + 1, 1);
          j = divNext;
          continue;
        }

        if (sub.tag === 'EVEN' && sub.level === 1) {
          const { nextIndex: evenNext } = collectSubLines(subLines, j + 1, 1);
          j = evenNext;
          continue;
        }

        if (sub.tag === 'SOUR' && sub.level === 1) {
          const { nextIndex: sourNext } = collectSubLines(subLines, j + 1, 1);
          j = sourNext;
          continue;
        }

        if (sub.tag === 'NOTE' && sub.level === 1) {
          const { nextIndex: noteNext } = collectSubLines(subLines, j + 1, 1);
          j = noteNext;
          continue;
        }

        if (sub.tag === 'CHAN' && sub.level === 1) {
          const { nextIndex: chanNext } = collectSubLines(subLines, j + 1, 1);
          j = chanNext;
          continue;
        }

        if (sub.tag === 'OBJE' && sub.level === 1) {
          const { nextIndex: objeNext } = collectSubLines(subLines, j + 1, 1);
          j = objeNext;
          continue;
        }

        const { nextIndex: skipNext } = collectSubLines(subLines, j + 1, sub.level);
        j = skipNext;
      }

      families.set(fam.id, fam);
      i = nextIndex;
      continue;
    }

    i++;
  }

  console.log(`[GEDCOM Parser] Found ${individuals.size} individuals and ${families.size} families`);

  if (individuals.size === 0) {
    console.warn('[GEDCOM Parser] WARNING: No individuals found. The file may not be valid GEDCOM or uses an unsupported format.');
  }

  inferGenderFromFamilyRoles(individuals, families);

  return { individuals, families };
}

function inferGenderFromFamilyRoles(
  individuals: Map<string, GedcomIndividual>,
  families: Map<string, GedcomFamily>
): void {
  let corrected = 0;
  let inferred = 0;

  families.forEach((family) => {
    if (family.husbandId) {
      const husband = individuals.get(family.husbandId);
      if (husband) {
        if (husband.sex === 'U') {
          husband.sex = 'M';
          inferred++;
        } else if (husband.sex === 'F') {
          const wife = family.wifeId ? individuals.get(family.wifeId) : undefined;
          if (wife && wife.sex === 'M') {
            husband.sex = 'M';
            wife.sex = 'F';
            corrected += 2;
          }
        }
      }
    }
    if (family.wifeId) {
      const wife = individuals.get(family.wifeId);
      if (wife) {
        if (wife.sex === 'U') {
          wife.sex = 'F';
          inferred++;
        } else if (wife.sex === 'M') {
          const husband = family.husbandId ? individuals.get(family.husbandId) : undefined;
          if (husband && husband.sex === 'F') {
            wife.sex = 'F';
            husband.sex = 'M';
            corrected += 2;
          }
        }
      }
    }
  });

  console.log(`[GEDCOM Parser] Gender inference: ${inferred} inferred, ${corrected} corrected from family roles`);
}

export function getGenderSafe(
  personId: string,
  data: FamilyTreeData
): 'M' | 'F' | 'U' {
  const person = data.individuals.get(personId);
  if (!person) return 'U';
  if (person.sex !== 'U') return person.sex;

  for (const famId of person.familiesAsSpouse) {
    const family = data.families.get(famId);
    if (!family) continue;
    if (family.husbandId === personId) return 'M';
    if (family.wifeId === personId) return 'F';
  }

  if (person.familyAsChild) {
    const family = data.families.get(person.familyAsChild);
    if (family) {
      if (family.husbandId === personId) return 'M';
      if (family.wifeId === personId) return 'F';
    }
  }

  return 'U';
}

export function getParents(
  personId: string,
  data: FamilyTreeData
): GedcomIndividual[] {
  const person = data.individuals.get(personId);
  if (!person?.familyAsChild) return [];

  const family = data.families.get(person.familyAsChild);
  if (!family) return [];

  const parents: GedcomIndividual[] = [];
  if (family.husbandId) {
    const father = data.individuals.get(family.husbandId);
    if (father) parents.push(father);
  }
  if (family.wifeId) {
    const mother = data.individuals.get(family.wifeId);
    if (mother) parents.push(mother);
  }
  return parents;
}

export function getSpouses(
  personId: string,
  data: FamilyTreeData
): GedcomIndividual[] {
  const person = data.individuals.get(personId);
  if (!person) return [];

  const spouses: GedcomIndividual[] = [];
  for (const famId of person.familiesAsSpouse) {
    const family = data.families.get(famId);
    if (!family) continue;

    if (family.husbandId && family.husbandId !== personId) {
      const spouse = data.individuals.get(family.husbandId);
      if (spouse) spouses.push(spouse);
    }
    if (family.wifeId && family.wifeId !== personId) {
      const spouse = data.individuals.get(family.wifeId);
      if (spouse) spouses.push(spouse);
    }
  }
  return spouses;
}

export function getChildren(
  personId: string,
  data: FamilyTreeData
): GedcomIndividual[] {
  const person = data.individuals.get(personId);
  if (!person) return [];

  const children: GedcomIndividual[] = [];
  for (const famId of person.familiesAsSpouse) {
    const family = data.families.get(famId);
    if (!family) continue;

    for (const childId of family.childrenIds) {
      const child = data.individuals.get(childId);
      if (child) children.push(child);
    }
  }
  return children;
}

export function getSiblings(
  personId: string,
  data: FamilyTreeData
): GedcomIndividual[] {
  const person = data.individuals.get(personId);
  if (!person?.familyAsChild) return [];

  const family = data.families.get(person.familyAsChild);
  if (!family) return [];

  return family.childrenIds
    .filter((id) => id !== personId)
    .map((id) => data.individuals.get(id))
    .filter((p): p is GedcomIndividual => p !== undefined);
}

function hasDisplayableName(person: GedcomIndividual): boolean {
  const name = (person.name ?? '').replace(/\//g, '').trim();
  const given = (person.givenName ?? '').trim();
  const surname = (person.surname ?? '').trim();
  if (!name && !given && !surname) return false;
  if (name === 'Unknown' && !given && !surname) return false;
  return true;
}

function getSearchableNames(person: GedcomIndividual): {
  firstName: string;
  surname: string;
  fullGiven: string;
  fullName: string;
} {
  let givenName = (person.givenName ?? '').trim();
  let surnameName = (person.surname ?? '').trim();
  let personName = (person.name ?? '').replace(/\//g, '').trim();

  if (!givenName && !surnameName && personName) {
    const parts = personName.split(/\s+/);
    if (parts.length >= 2) {
      givenName = parts.slice(0, -1).join(' ');
      surnameName = parts[parts.length - 1];
    } else {
      givenName = personName;
    }
  }

  if (!personName && (givenName || surnameName)) {
    personName = `${givenName} ${surnameName}`.trim();
  }

  return {
    firstName: givenName.toLowerCase().split(/\s+/)[0] || '',
    surname: surnameName.toLowerCase(),
    fullGiven: givenName.toLowerCase(),
    fullName: personName.toLowerCase(),
  };
}

const MAX_SEARCH_RESULTS = 100;

export function searchIndividuals(
  query: string,
  data: FamilyTreeData
): GedcomIndividual[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase().trim();
  const queryParts = lower.split(/\s+/).filter(Boolean);

  const scored: { person: GedcomIndividual; score: number }[] = [];
  let checked = 0;
  let filtered = 0;
  let lowestKeptScore = -1;

  const iter = data.individuals.values();
  let next = iter.next();
  while (!next.done) {
    const person = next.value;
    checked++;

    if (!hasDisplayableName(person)) {
      filtered++;
      next = iter.next();
      continue;
    }

    const { firstName, surname, fullGiven, fullName } = getSearchableNames(person);

    let score = -1;

    if (queryParts.length >= 2) {
      const firstQ = queryParts[0];
      const lastQ = queryParts[queryParts.length - 1];
      if (firstName.startsWith(firstQ) && surname.startsWith(lastQ)) {
        score = 100;
      } else if (firstName.includes(firstQ) && surname.includes(lastQ)) {
        score = 90;
      } else if (surname.startsWith(firstQ) && firstName.startsWith(lastQ)) {
        score = 85;
      } else if (fullName.includes(queryParts.join(' '))) {
        score = 75;
      }
    }

    if (score < 0) {
      if (firstName === lower || surname === lower) {
        score = 80;
      } else if (firstName.startsWith(lower)) {
        score = 70;
      } else if (surname.startsWith(lower)) {
        score = 65;
      } else if (firstName.includes(lower) || surname.includes(lower)) {
        score = 50;
      } else if (fullGiven.includes(lower)) {
        score = 30;
      } else if (fullName.includes(lower)) {
        score = 25;
      } else if (score < 0 && lowestKeptScore <= 10) {
        const birthPlace = person.birthPlace?.toLowerCase() || '';
        const deathPlace = person.deathPlace?.toLowerCase() || '';
        if (birthPlace.includes(lower) || deathPlace.includes(lower)) {
          score = 10;
        } else {
          const personId = person.id.toLowerCase();
          if (personId.includes(lower)) {
            score = 5;
          }
        }
      }
    }

    if (score >= 0) {
      if (scored.length < MAX_SEARCH_RESULTS || score > lowestKeptScore) {
        scored.push({ person, score });
      }
    }

    next = iter.next();
  }

  console.log('[Search] Query:', query, '| Checked:', checked, '| Filtered:', filtered, '| Matched:', scored.length);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.person.surname ?? '').localeCompare(b.person.surname ?? '') ||
      (a.person.givenName ?? '').localeCompare(b.person.givenName ?? '');
  });

  const trimmed = scored.length > MAX_SEARCH_RESULTS ? scored.slice(0, MAX_SEARCH_RESULTS) : scored;
  return trimmed.map((s) => s.person);
}

export function findRelationshipPath(
  fromId: string,
  toId: string,
  data: FamilyTreeData
): string[] | null {
  if (fromId === toId) return [fromId];

  const visited = new Set<string>();
  const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.path.length > 20) continue;

    const person = data.individuals.get(current.id);
    if (!person) continue;

    const neighbors: string[] = [];

    const parents = getParents(current.id, data);
    for (const p of parents) neighbors.push(p.id);

    const children = getChildren(current.id, data);
    for (const c of children) neighbors.push(c.id);

    const spouses = getSpouses(current.id, data);
    for (const s of spouses) neighbors.push(s.id);

    const siblings = getSiblings(current.id, data);
    for (const s of siblings) neighbors.push(s.id);

    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue;
      const newPath = [...current.path, neighborId];
      if (neighborId === toId) return newPath;
      queue.push({ id: neighborId, path: newPath });
    }
  }

  return null;
}

export function describeRelationship(
  path: string[],
  data: FamilyTreeData
): string {
  if (path.length === 1) return 'Self';
  if (path.length === 2) {
    const from = data.individuals.get(path[0]);
    const to = data.individuals.get(path[1]);
    if (!from || !to) return 'Related';

    const fromParents = getParents(path[0], data);
    const toParents = getParents(path[1], data);

    if (fromParents.some((p) => p.id === path[1])) {
      return to.sex === 'F' ? 'Mother' : 'Father';
    }
    if (toParents.some((p) => p.id === path[0])) {
      return to.sex === 'F' ? 'Daughter' : 'Son';
    }

    const fromSpouses = getSpouses(path[0], data);
    if (fromSpouses.some((s) => s.id === path[1])) {
      return to.sex === 'F' ? 'Wife' : 'Husband';
    }

    const fromSiblings = getSiblings(path[0], data);
    if (fromSiblings.some((s) => s.id === path[1])) {
      return to.sex === 'F' ? 'Sister' : 'Brother';
    }

    return 'Related';
  }

  const steps = path.length - 1;
  if (steps <= 3) {
    return `${steps}-step relation`;
  }
  return `${steps}-step distant relation`;
}

export function serializeFamilyTreeData(data: FamilyTreeData): string {
  const obj = {
    individuals: Array.from(data.individuals.entries()),
    families: Array.from(data.families.entries()),
  };
  return JSON.stringify(obj);
}

export function deserializeFamilyTreeData(json: string): FamilyTreeData {
  try {
    const obj = JSON.parse(json);
    return {
      individuals: new Map(obj.individuals || []),
      families: new Map(obj.families || []),
    };
  } catch (e) {
    console.error('[GEDCOM Parser] Failed to deserialize stored data:', e);
    return { individuals: new Map(), families: new Map() };
  }
}
