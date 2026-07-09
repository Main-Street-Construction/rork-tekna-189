import { FamilyTreeData, GedcomIndividual } from '@/types/genealogy';

export function normalizeNamePart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeFullName(givenName: string, surname: string): string {
  return normalizeNamePart([givenName, surname].filter(Boolean).join(' '));
}

const COMMON_VARIANTS: Record<string, string[]> = {
  catherine: ['katherine', 'kathryn', 'catharine'],
  katherine: ['catherine', 'kathryn', 'catharine'],
  jon: ['john'],
  john: ['jon'],
  william: ['bill', 'willy', 'will'],
  elizabeth: ['liz', 'beth', 'eliza'],
  jacob: ['jakob'],
};

function namesAreSimilar(a: string, b: string): boolean {
  const na = normalizeNamePart(a);
  const nb = normalizeNamePart(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const variantsA = COMMON_VARIANTS[na] ?? [];
  const variantsB = COMMON_VARIANTS[nb] ?? [];
  return variantsA.includes(nb) || variantsB.includes(na);
}

export function findSimilarIndividuals(
  givenName: string,
  surname: string,
  birthDate: string | undefined,
  treeData: FamilyTreeData,
  excludeId?: string
): GedcomIndividual[] {
  const trimmedGiven = givenName.trim();
  const trimmedSurname = surname.trim();
  if (!trimmedGiven && !trimmedSurname) return [];

  const matches: GedcomIndividual[] = [];
  const birthYear = birthDate?.match(/\d{4}/)?.[0];

  for (const person of treeData.individuals.values()) {
    if (excludeId && person.id === excludeId) continue;

    const givenMatch =
      trimmedGiven &&
      (namesAreSimilar(trimmedGiven, person.givenName) ||
        namesAreSimilar(trimmedGiven, person.name));
    const surnameMatch =
      !trimmedSurname ||
      namesAreSimilar(trimmedSurname, person.surname) ||
      normalizeNamePart(person.surname) === normalizeNamePart(trimmedSurname);

    if (!givenMatch || !surnameMatch) continue;

    if (birthYear && person.birthDate) {
      const personYear = person.birthDate.match(/\d{4}/)?.[0];
      if (personYear && personYear !== birthYear) continue;
    }

    matches.push(person);
    if (matches.length >= 5) break;
  }

  return matches;
}

export function findDuplicateCandidates(treeData: FamilyTreeData): Array<{ a: GedcomIndividual; b: GedcomIndividual; score: number }> {
  const people = Array.from(treeData.individuals.values());
  const pairs: Array<{ a: GedcomIndividual; b: GedcomIndividual; score: number }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;

      const givenMatch = namesAreSimilar(a.givenName, b.givenName) || namesAreSimilar(a.name, b.name);
      const surnameMatch = namesAreSimilar(a.surname, b.surname);
      if (!givenMatch || !surnameMatch) continue;

      let score = 2;
      if (a.birthDate && b.birthDate && a.birthDate === b.birthDate) score += 2;
      if (a.birthPlace && b.birthPlace && normalizeNamePart(a.birthPlace) === normalizeNamePart(b.birthPlace)) score += 1;

      if (score >= 2) {
        seen.add(key);
        pairs.push({ a, b, score });
      }
    }
  }

  return pairs.sort((x, y) => y.score - x.score).slice(0, 50);
}
