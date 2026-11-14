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

function parseEventSubLines(
  subLines: ParsedLine[],
  noteRecords: Map<string, string>
): { date?: string; place?: string; note?: string } {
  let date: string | undefined;
  let place: string | undefined;
  let note: string | undefined;

  for (let idx = 0; idx < subLines.length; idx++) {
    const sl = subLines[idx];
    if (sl.tag === 'DATE' && !date) {
      date = sl.value;
    }
    if (sl.tag === 'PLAC' && !place) {
      place = sl.value;
    }
    if (sl.tag === 'NOTE') {
      const { value: noteVal, nextIndex } = buildConcatenatedValue(subLines, idx, sl.level);
      const resolved = resolveNoteText(noteVal, noteRecords);
      if (resolved) {
        note = note ? `${note}\n${resolved}` : resolved;
      }
      idx = nextIndex - 1;
    }
  }

  return { date, place, note };
}

function resolveNoteText(raw: string, noteRecords: Map<string, string>): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const xrefMatch = trimmed.match(/^@([^@]+)@$/);
  if (xrefMatch) {
    return noteRecords.get(xrefMatch[1]) ?? '';
  }

  return trimmed;
}

function appendPersonNote(indi: GedcomIndividual, noteText: string) {
  const text = noteText.trim();
  if (!text) return;
  indi.note = indi.note ? `${indi.note}\n${text}` : text;
}

function collectNoteRecords(parsedLines: ParsedLine[]): Map<string, string> {
  const noteRecords = new Map<string, string>();
  let i = 0;

  while (i < parsedLines.length) {
    const line = parsedLines[i];
    if (line.level === 0 && line.tag === 'NOTE' && line.xref) {
      const { subLines, nextIndex } = collectSubLines(parsedLines, i + 1, 0);
      const noteLines: ParsedLine[] = [
        { level: 1, xref: '', tag: 'NOTE', value: line.value },
        ...subLines,
      ];
      const { value } = buildConcatenatedValue(noteLines, 0, 1);
      const resolved = value.trim();
      if (resolved) {
        noteRecords.set(line.xref, resolved);
      }
      i = nextIndex;
      continue;
    }
    i++;
  }

  return noteRecords;
}

function appendNoteText(existing: string | undefined, addition: string): string {
  const text = addition.trim();
  if (!text) return existing ?? '';
  return existing ? `${existing}\n${text}` : text;
}

function readNoteContinuation(rawLines: string[], startIndex: number, minLevel: number): { text: string; nextIndex: number } {
  let text = '';
  let i = startIndex;
  while (i < rawLines.length) {
    const parsed = parseLine(rawLines[i]);
    if (!parsed || parsed.level <= minLevel) break;
    if (parsed.tag === 'CONT') {
      text += (text ? '\n' : '') + parsed.value;
    } else if (parsed.tag === 'CONC') {
      text += parsed.value;
    }
    i++;
  }
  return { text, nextIndex: i };
}

/** Fast single-pass extraction for large GEDCOM files — only person IDs and notes. */
export function extractGedcomNotes(content: string): Map<string, string> {
  const cleaned = stripBom(content);
  const rawLines = cleaned.split(/\r?\n|\r/);
  const noteRecords = new Map<string, string>();
  const personNotes = new Map<string, string>();

  let i = 0;
  while (i < rawLines.length) {
    const parsed = parseLine(rawLines[i]);
    if (!parsed) {
      i++;
      continue;
    }

    if (parsed.level === 0 && parsed.tag === 'NOTE' && parsed.xref) {
      let noteText = parsed.value;
      const continuation = readNoteContinuation(rawLines, i + 1, 0);
      noteText = appendNoteText(noteText, continuation.text);
      i = continuation.nextIndex;
      if (noteText.trim()) {
        noteRecords.set(parsed.xref, noteText.trim());
      }
      continue;
    }

    if (parsed.level === 0 && parsed.tag === 'INDI' && parsed.xref) {
      const personId = parsed.xref;
      i++;
      while (i < rawLines.length) {
        const sub = parseLine(rawLines[i]);
        if (!sub || sub.level === 0) break;

        if (sub.tag === 'NOTE') {
          let noteText = sub.value;
          const continuation = readNoteContinuation(rawLines, i + 1, sub.level);
          noteText = appendNoteText(noteText, continuation.text);
          i = continuation.nextIndex;
          const resolved = resolveNoteText(noteText, noteRecords);
          if (resolved) {
            personNotes.set(personId, appendNoteText(personNotes.get(personId), resolved));
          }
          continue;
        }

        if (sub.tag === 'BIRT' || sub.tag === 'DEAT') {
          i++;
          while (i < rawLines.length) {
            const eventLine = parseLine(rawLines[i]);
            if (!eventLine || eventLine.level <= 1) break;
            if (eventLine.tag === 'NOTE') {
              let noteText = eventLine.value;
              const continuation = readNoteContinuation(rawLines, i + 1, eventLine.level);
              noteText = appendNoteText(noteText, continuation.text);
              i = continuation.nextIndex;
              const resolved = resolveNoteText(noteText, noteRecords);
              if (resolved) {
                personNotes.set(personId, appendNoteText(personNotes.get(personId), resolved));
              }
              continue;
            }
            i++;
          }
          continue;
        }

        i++;
      }
      continue;
    }

    i++;
  }

  return personNotes;
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

  const noteRecords = collectNoteRecords(parsedLines);
  if (noteRecords.size > 0) {
    console.log(`[GEDCOM Parser] Found ${noteRecords.size} shared note records`);
  }

  const individuals = new Map<string, GedcomIndividual>();
  const families = new Map<string, GedcomFamily>();

  let i = 0;
  while (i < parsedLines.length) {
    const line = parsedLines[i];

    if (line.level === 0 && line.tag === 'NOTE') {
      const { nextIndex } = collectSubLines(parsedLines, i + 1, 0);
      i = nextIndex;
      continue;
    }

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
          const evt = parseEventSubLines(eventSub, noteRecords);
          if (evt.date) indi.birthDate = evt.date;
          if (evt.place) indi.birthPlace = evt.place;
          if (evt.note) appendPersonNote(indi, evt.note);
          continue;
        }

        if (sub.tag === 'DEAT' && sub.level === 1) {
          const { subLines: eventSub, nextIndex: eventNext } = collectSubLines(subLines, j + 1, 1);
          j = eventNext;
          const evt = parseEventSubLines(eventSub, noteRecords);
          if (evt.date) indi.deathDate = evt.date;
          if (evt.place) indi.deathPlace = evt.place;
          if (evt.note) appendPersonNote(indi, evt.note);
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
          appendPersonNote(indi, resolveNoteText(noteVal, noteRecords));
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
          const evt = parseEventSubLines(marrSub, noteRecords);
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
          const { nextIndex: noteNext } = buildConcatenatedValue(subLines, j, 1);
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

  const spouseFams = person.familiesAsSpouse;
  if (Array.isArray(spouseFams)) {
    for (const famId of spouseFams) {
      const family = data.families.get(famId);
      if (!family) continue;
      if (family.husbandId === personId) return 'M';
      if (family.wifeId === personId) return 'F';
    }
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
  if (!person) return [];

  if (person.familyAsChild) {
    const family = data.families.get(person.familyAsChild);
    if (family) {
      const childIds = Array.isArray(family.childrenIds) ? family.childrenIds : [];
      if (childIds.includes(personId)) {
        const parents: GedcomIndividual[] = [];
        if (family.husbandId) {
          const father = data.individuals.get(family.husbandId);
          if (father) parents.push(father);
        }
        if (family.wifeId) {
          const mother = data.individuals.get(family.wifeId);
          if (mother) parents.push(mother);
        }
        if (parents.length > 0) return parents;
      } else {
        console.warn('[getParents] Person', personId, 'has familyAsChild =', person.familyAsChild,
          'but is NOT in that family\'s childrenIds. Falling through to scan.');
      }
    }
  }

  const allMatchingFamilies: { family: GedcomFamily; parents: GedcomIndividual[] }[] = [];
  const familyIter = data.families.values();
  let next = familyIter.next();
  while (!next.done) {
    const fam = next.value;
    if (Array.isArray(fam.childrenIds) && fam.childrenIds.includes(personId)) {
      const parents: GedcomIndividual[] = [];
      if (fam.husbandId) {
        const father = data.individuals.get(fam.husbandId);
        if (father) parents.push(father);
      }
      if (fam.wifeId) {
        const mother = data.individuals.get(fam.wifeId);
        if (mother) parents.push(mother);
      }
      if (parents.length > 0) {
        allMatchingFamilies.push({ family: fam, parents });
      }
    }
    next = familyIter.next();
  }

  if (allMatchingFamilies.length > 1) {
    console.warn('[getParents] Person', personId, 'found in', allMatchingFamilies.length,
      'families:', allMatchingFamilies.map(f => f.family.id).join(', '));
  }

  if (allMatchingFamilies.length > 0) {
    const best = allMatchingFamilies.reduce((a, b) => {
      return b.parents.length > a.parents.length ? b : a;
    });

    if (!person.familyAsChild || person.familyAsChild !== best.family.id) {
      console.warn('[getParents] Person', personId, 'familyAsChild mismatch; using family', best.family.id);
    }
    return best.parents;
  }

  return [];
}

export function getSpouses(
  personId: string,
  data: FamilyTreeData
): GedcomIndividual[] {
  const person = data.individuals.get(personId);
  if (!person) return [];

  const spouses: GedcomIndividual[] = [];
  const seen = new Set<string>();
  const spouseFamIds = Array.isArray(person.familiesAsSpouse) ? person.familiesAsSpouse : [];
  for (const famId of spouseFamIds) {
    const family = data.families.get(famId);
    if (!family) continue;

    if (family.husbandId && family.husbandId !== personId) {
      const spouse = data.individuals.get(family.husbandId);
      if (spouse && !seen.has(spouse.id)) {
        seen.add(spouse.id);
        spouses.push(spouse);
      }
    }
    if (family.wifeId && family.wifeId !== personId) {
      const spouse = data.individuals.get(family.wifeId);
      if (spouse && !seen.has(spouse.id)) {
        seen.add(spouse.id);
        spouses.push(spouse);
      }
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
  const seen = new Set<string>();
  const childFamIds = Array.isArray(person.familiesAsSpouse) ? person.familiesAsSpouse : [];
  for (const famId of childFamIds) {
    const family = data.families.get(famId);
    if (!family) continue;
    const kidIds = Array.isArray(family.childrenIds) ? family.childrenIds : [];
    for (const childId of kidIds) {
      if (seen.has(childId)) continue;
      const child = data.individuals.get(childId);
      if (child) {
        seen.add(childId);
        children.push(child);
      }
    }
  }
  return children;
}

/**
 * Siblings via shared parents across all families (matches relationship calculator).
 * Includes half-siblings and children split across parallel/duplicate families.
 */
export function getSiblings(
  personId: string,
  data: FamilyTreeData
): GedcomIndividual[] {
  if (!data.individuals.has(personId)) return [];

  const parentIds = new Set<string>();
  const addParentsFromFamily = (family: GedcomFamily | undefined) => {
    if (!family) return;
    if (family.husbandId) parentIds.add(family.husbandId);
    if (family.wifeId) parentIds.add(family.wifeId);
  };

  const person = data.individuals.get(personId);
  if (person?.familyAsChild) {
    addParentsFromFamily(data.families.get(person.familyAsChild));
  }

  data.families.forEach((family) => {
    const kids = Array.isArray(family.childrenIds) ? family.childrenIds : [];
    if (kids.includes(personId)) {
      addParentsFromFamily(family);
    }
  });

  if (parentIds.size === 0) return [];

  const siblingIds = new Set<string>();
  data.families.forEach((family) => {
    const sharesParent =
      (family.husbandId != null && parentIds.has(family.husbandId)) ||
      (family.wifeId != null && parentIds.has(family.wifeId));
    if (!sharesParent) return;
    const kids = Array.isArray(family.childrenIds) ? family.childrenIds : [];
    for (const childId of kids) {
      if (childId !== personId) siblingIds.add(childId);
    }
  });

  const siblings: GedcomIndividual[] = [];
  siblingIds.forEach((id) => {
    const sib = data.individuals.get(id);
    if (sib) siblings.push(sib);
  });
  return siblings;
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

const MAX_SEARCH_RESULTS = 40;

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearch(value: string): string[] {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

type SearchIndexEntry = {
  person: GedcomIndividual;
  firstName: string;
  surname: string;
  fullName: string;
  tokens: string[];
  idLower: string;
};

type SearchIndex = {
  entries: SearchIndexEntry[];
  /** 2-char token prefixes → entry indices (prunes ~69k scans on typing). */
  byPrefix: Map<string, number[]>;
};

/** Rebuild only when the individuals map identity changes. */
const searchIndexCache = new WeakMap<Map<string, GedcomIndividual>, SearchIndex>();

function getSearchIndex(data: FamilyTreeData): SearchIndex {
  const cached = searchIndexCache.get(data.individuals);
  if (cached) return cached;

  const entries: SearchIndexEntry[] = [];
  const byPrefix = new Map<string, number[]>();

  const addPrefix = (token: string, idx: number) => {
    if (token.length < 2) return;
    const key = token.slice(0, 2);
    const bucket = byPrefix.get(key);
    if (bucket) {
      if (bucket[bucket.length - 1] !== idx) bucket.push(idx);
    } else {
      byPrefix.set(key, [idx]);
    }
  };

  for (const person of data.individuals.values()) {
    if (!hasDisplayableName(person)) continue;
    const { firstName, surname, fullGiven, fullName } = getSearchableNames(person);
    const tokenSet = new Set<string>();
    for (const t of tokenizeSearch(fullGiven)) tokenSet.add(t);
    for (const t of tokenizeSearch(surname)) tokenSet.add(t);
    for (const t of tokenizeSearch(fullName)) tokenSet.add(t);
    if (firstName) tokenSet.add(firstName);
    if (surname) tokenSet.add(surname);
    const idx = entries.length;
    const tokens = Array.from(tokenSet);
    entries.push({
      person,
      firstName,
      surname,
      fullName,
      tokens,
      idLower: person.id.toLowerCase(),
    });
    for (let t = 0; t < tokens.length; t++) addPrefix(tokens[t], idx);
  }

  const built: SearchIndex = { entries, byPrefix };
  searchIndexCache.set(data.individuals, built);
  return built;
}

/** Build search index after tree load so the first keystroke stays snappy. */
export function prewarmSearchIndex(data: FamilyTreeData): void {
  getSearchIndex(data);
}

function candidateIndices(index: SearchIndex, queryTokens: string[]): number[] | null {
  // Use the longest token's 2-char prefix — usually the most selective.
  let best: number[] | null = null;
  for (let i = 0; i < queryTokens.length; i++) {
    const qt = queryTokens[i];
    if (qt.length < 2) continue;
    const bucket = index.byPrefix.get(qt.slice(0, 2));
    if (!bucket) return []; // prefix miss → no candidates
    if (!best || bucket.length < best.length) best = bucket;
  }
  // Only use the bucket if it meaningfully prunes the scan.
  if (best && best.length < index.entries.length * 0.55) return best;
  return null;
}

/** Fast token score — no edit-distance on the hot path. */
function scoreTokenFast(queryToken: string, candidate: string): number {
  if (!candidate) return 0;
  if (candidate === queryToken) return 100;
  if (candidate.startsWith(queryToken)) return 85;
  if (queryToken.length >= 3 && candidate.includes(queryToken)) return 55;
  if (queryToken.startsWith(candidate) && candidate.length >= 3) return 45;
  return 0;
}

/**
 * Soft search: case-insensitive, token order doesn't matter, middle names optional.
 * Uses a cached name index; fuzzy/typo matching is skipped for speed on large trees.
 */
export function searchIndividuals(
  query: string,
  data: FamilyTreeData
): GedcomIndividual[] {
  const queryTokens = tokenizeSearch(query);
  if (queryTokens.length === 0) return [];

  const index = getSearchIndex(data);
  const scored: { person: GedcomIndividual; score: number }[] = [];
  let lowestKept = -1;
  const candidates = candidateIndices(index, queryTokens);
  const totalEntries = index.entries.length;
  const scanCount = candidates ? candidates.length : totalEntries;

  for (let c = 0; c < scanCount; c++) {
    const i = candidates ? candidates[c] : c;
    const entry = index.entries[i];
    let totalScore = 0;
    let allMatched = true;

    for (let t = 0; t < queryTokens.length; t++) {
      const qt = queryTokens[t];
      let best = 0;
      const tokens = entry.tokens;
      for (let n = 0; n < tokens.length; n++) {
        const s = scoreTokenFast(qt, tokens[n]);
        if (s > best) {
          best = s;
          if (best >= 100) break;
        }
      }
      // Skip expensive fullName/id includes when we already have a token miss on short queries —
      // prefix bucket already scoped candidates.
      if (best === 0 && entry.fullName.includes(qt)) best = 40;
      if (best === 0 && qt.length >= 3 && entry.idLower.includes(qt)) best = 12;
      if (best === 0) {
        allMatched = false;
        break;
      }
      totalScore += best;
    }

    if (!allMatched) continue;

    if (
      queryTokens.length >= 2 &&
      entry.firstName.startsWith(queryTokens[0]) &&
      entry.surname.startsWith(queryTokens[queryTokens.length - 1])
    ) {
      totalScore += 25;
    }

    if (scored.length < MAX_SEARCH_RESULTS) {
      scored.push({ person: entry.person, score: totalScore });
      if (totalScore < lowestKept || lowestKept < 0) lowestKept = totalScore;
    } else if (totalScore > lowestKept) {
      // Replace weakest kept hit instead of unbounded growth.
      let weakIdx = 0;
      let weakScore = scored[0].score;
      for (let s = 1; s < scored.length; s++) {
        if (scored[s].score < weakScore) {
          weakScore = scored[s].score;
          weakIdx = s;
        }
      }
      scored[weakIdx] = { person: entry.person, score: totalScore };
      lowestKept = Infinity;
      for (let s = 0; s < scored.length; s++) {
        if (scored[s].score < lowestKept) lowestKept = scored[s].score;
      }
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.person.surname ?? '').localeCompare(b.person.surname ?? '') ||
      (a.person.givenName ?? '').localeCompare(b.person.givenName ?? '');
  });

  return scored.map((s) => s.person);
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

type CompactIndividual = [
  string,
  string,
  string,
  string,
  string,
  string | 0,
  string | 0,
  string | 0,
  string | 0,
  string[],
  string | 0,
  string | 0,
  string | 0,
];

type CompactFamily = [
  string,
  string | 0,
  string | 0,
  string[],
  string | 0,
  string | 0,
];

function compactIndividual(ind: GedcomIndividual): CompactIndividual {
  return [
    ind.id,
    ind.name,
    ind.givenName,
    ind.surname,
    ind.sex,
    ind.birthDate || 0,
    ind.birthPlace || 0,
    ind.deathDate || 0,
    ind.deathPlace || 0,
    ind.familiesAsSpouse,
    ind.familyAsChild || 0,
    ind.occupation || 0,
    ind.note || 0,
  ];
}

function expandIndividual(c: CompactIndividual): GedcomIndividual {
  const ind: GedcomIndividual = {
    id: c[0],
    name: c[1] || '',
    givenName: c[2] || '',
    surname: c[3] || '',
    sex: (c[4] === 'M' || c[4] === 'F') ? c[4] : 'U',
    familiesAsSpouse: Array.isArray(c[9]) ? c[9] : [],
  };
  if (c[5]) ind.birthDate = c[5] as string;
  if (c[6]) ind.birthPlace = c[6] as string;
  if (c[7]) ind.deathDate = c[7] as string;
  if (c[8]) ind.deathPlace = c[8] as string;
  if (c[10]) ind.familyAsChild = c[10] as string;
  if (c[11]) ind.occupation = c[11] as string;
  if (c[12]) ind.note = c[12] as string;
  return ind;
}

function compactFamily(fam: GedcomFamily): CompactFamily {
  return [
    fam.id,
    fam.husbandId || 0,
    fam.wifeId || 0,
    fam.childrenIds,
    fam.marriageDate || 0,
    fam.marriagePlace || 0,
  ];
}

function expandFamily(c: CompactFamily): GedcomFamily {
  const fam: GedcomFamily = {
    id: c[0],
    childrenIds: Array.isArray(c[3]) ? c[3] : [],
  };
  if (c[1]) fam.husbandId = c[1] as string;
  if (c[2]) fam.wifeId = c[2] as string;
  if (c[4]) fam.marriageDate = c[4] as string;
  if (c[5]) fam.marriagePlace = c[5] as string;
  return fam;
}

export function serializeFamilyTreeData(data: FamilyTreeData): string {
  const compactInd: CompactIndividual[] = [];
  data.individuals.forEach((ind) => {
    compactInd.push(compactIndividual(ind));
  });
  const compactFam: CompactFamily[] = [];
  data.families.forEach((fam) => {
    compactFam.push(compactFamily(fam));
  });
  return JSON.stringify({ v: 7, i: compactInd, f: compactFam });
}

export function deserializeFamilyTreeData(json: string): FamilyTreeData {
  try {
    const obj = JSON.parse(json);

    if (obj.v === 7 && obj.i) {
      const individuals = new Map<string, GedcomIndividual>();
      for (let idx = 0; idx < obj.i.length; idx++) {
        const ind = expandIndividual(obj.i[idx]);
        individuals.set(ind.id, ind);
      }
      const families = new Map<string, GedcomFamily>();
      for (let idx = 0; idx < obj.f.length; idx++) {
        const fam = expandFamily(obj.f[idx]);
        families.set(fam.id, fam);
      }
      return { individuals, families };
    }

    return {
      individuals: new Map(obj.individuals || []),
      families: new Map(obj.families || []),
    };
  } catch (e) {
    console.error('[GEDCOM Parser] Failed to deserialize stored data:', e);
    return { individuals: new Map(), families: new Map() };
  }
}
