import { FamilyTreeData, GedcomIndividual } from '@/types/genealogy';
import { getGenderSafe } from '@/utils/gedcom-parser';

export interface CommonAncestorResult {
  ancestorId: string;
  ancestor: GedcomIndividual;
  pathFromAncestorToPerson1: string[];
  pathFromAncestorToPerson2: string[];
  generationsTo1: number;
  generationsTo2: number;
}

export interface RelationshipResult {
  person1: GedcomIndividual;
  person2: GedcomIndividual;
  relationship: string;
  reverseRelationship: string;
  commonAncestors: CommonAncestorResult[];
  fullPath: string[];
}

const MAX_GENERATIONS = 25;

function buildParentIndex(data: FamilyTreeData): Map<string, string[]> {
  const parentIndex = new Map<string, string[]>();

  const addParents = (childId: string, husbandId?: string, wifeId?: string) => {
    if (!data.individuals.has(childId)) return;
    const parents: string[] = [];
    if (husbandId && data.individuals.has(husbandId)) parents.push(husbandId);
    if (wifeId && data.individuals.has(wifeId)) parents.push(wifeId);
    if (parents.length === 0) return;

    const existing = parentIndex.get(childId);
    if (!existing) {
      parentIndex.set(childId, parents);
    } else {
      for (const pid of parents) {
        if (!existing.includes(pid)) {
          existing.push(pid);
        }
      }
    }
  };

  data.individuals.forEach((person) => {
    if (person.familyAsChild) {
      const family = data.families.get(person.familyAsChild);
      if (family) {
        addParents(person.id, family.husbandId, family.wifeId);
      }
    }
  });

  data.families.forEach((family) => {
    for (const childId of family.childrenIds) {
      addParents(childId, family.husbandId, family.wifeId);
    }
  });

  return parentIndex;
}

function buildChildIndex(data: FamilyTreeData): Map<string, string[]> {
  const childIndex = new Map<string, string[]>();

  data.families.forEach((family) => {
    const addChildren = (parentId: string) => {
      if (!data.individuals.has(parentId)) return;
      const existing = childIndex.get(parentId) ?? [];
      for (const childId of family.childrenIds) {
        if (data.individuals.has(childId) && !existing.includes(childId)) {
          existing.push(childId);
        }
      }
      if (existing.length > 0) childIndex.set(parentId, existing);
    };
    if (family.husbandId) addChildren(family.husbandId);
    if (family.wifeId) addChildren(family.wifeId);
  });

  return childIndex;
}

function buildSpouseIndex(data: FamilyTreeData): Map<string, string[]> {
  const spouseIndex = new Map<string, string[]>();

  data.families.forEach((family) => {
    if (family.husbandId && family.wifeId &&
        data.individuals.has(family.husbandId) && data.individuals.has(family.wifeId)) {
      const hSpouses = spouseIndex.get(family.husbandId) ?? [];
      if (!hSpouses.includes(family.wifeId)) hSpouses.push(family.wifeId);
      spouseIndex.set(family.husbandId, hSpouses);

      const wSpouses = spouseIndex.get(family.wifeId) ?? [];
      if (!wSpouses.includes(family.husbandId)) wSpouses.push(family.husbandId);
      spouseIndex.set(family.wifeId, wSpouses);
    }
  });

  return spouseIndex;
}

function getAncestorMap(
  personId: string,
  data: FamilyTreeData,
  parentIndex: Map<string, string[]>,
  earlyExitId?: string
): Map<string, { generations: number; path: string[] }> {
  const ancestors = new Map<string, { generations: number; path: string[] }>();
  const queue: { id: string; generations: number; path: string[] }[] = [
    { id: personId, generations: 0, path: [personId] },
  ];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    if (ancestors.has(current.id)) continue;

    ancestors.set(current.id, {
      generations: current.generations,
      path: current.path,
    });

    if (earlyExitId && current.id === earlyExitId && current.generations > 0) {
      return ancestors;
    }

    if (current.generations >= MAX_GENERATIONS) continue;

    const parentIds = parentIndex.get(current.id);
    if (parentIds) {
      for (let i = 0; i < parentIds.length; i++) {
        const pid = parentIds[i];
        if (!ancestors.has(pid)) {
          queue.push({
            id: pid,
            generations: current.generations + 1,
            path: [...current.path, pid],
          });
        }
      }
    }
  }

  return ancestors;
}

export function findCommonAncestors(
  person1Id: string,
  person2Id: string,
  data: FamilyTreeData
): CommonAncestorResult[] {
  if (!data.individuals.has(person1Id) || !data.individuals.has(person2Id)) return [];
  if (person1Id === person2Id) return [];

  const parentIndex = buildParentIndex(data);
  const ancestors1 = getAncestorMap(person1Id, data, parentIndex);
  const ancestors2 = getAncestorMap(person2Id, data, parentIndex);

  const common: CommonAncestorResult[] = [];
  let bestTotal = Infinity;

  ancestors1.forEach((info1, ancestorId) => {
    if (info1.generations > bestTotal) return;

    const info2 = ancestors2.get(ancestorId);
    if (info2) {
      const total = info1.generations + info2.generations;
      if (total > 0 && total <= bestTotal) {
        const ancestor = data.individuals.get(ancestorId);
        if (ancestor) {
          if (total < bestTotal) {
            bestTotal = total;
            common.length = 0;
          }
          common.push({
            ancestorId,
            ancestor,
            pathFromAncestorToPerson1: [...info1.path].reverse(),
            pathFromAncestorToPerson2: [...info2.path].reverse(),
            generationsTo1: info1.generations,
            generationsTo2: info2.generations,
          });
        }
      }
    }
  });

  return common;
}

export function findAllCommonAncestors(
  person1Id: string,
  person2Id: string,
  data: FamilyTreeData
): CommonAncestorResult[] {
  if (!data.individuals.has(person1Id) || !data.individuals.has(person2Id)) return [];
  if (person1Id === person2Id) return [];

  const parentIndex = buildParentIndex(data);
  const ancestors1 = getAncestorMap(person1Id, data, parentIndex);
  const ancestors2 = getAncestorMap(person2Id, data, parentIndex);

  const common: CommonAncestorResult[] = [];

  ancestors1.forEach((info1, ancestorId) => {
    const info2 = ancestors2.get(ancestorId);
    if (info2) {
      const total = info1.generations + info2.generations;
      if (total > 0) {
        const ancestor = data.individuals.get(ancestorId);
        if (ancestor) {
          common.push({
            ancestorId,
            ancestor,
            pathFromAncestorToPerson1: [...info1.path].reverse(),
            pathFromAncestorToPerson2: [...info2.path].reverse(),
            generationsTo1: info1.generations,
            generationsTo2: info2.generations,
          });
        }
      }
    }
  });

  common.sort((a, b) => {
    const totalA = a.generationsTo1 + a.generationsTo2;
    const totalB = b.generationsTo1 + b.generationsTo2;
    if (totalA !== totalB) return totalA - totalB;
    return Math.abs(a.generationsTo1 - a.generationsTo2) -
           Math.abs(b.generationsTo1 - b.generationsTo2);
  });

  return common;
}

function getGreatPrefix(count: number): string {
  if (count <= 0) return '';
  if (count === 1) return 'Great-';
  return `${count}x Great-`;
}

function getOrdinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

export function describeRelationshipFromGenerations(
  gen1: number,
  gen2: number,
  person2Sex: 'M' | 'F' | 'U'
): string {
  if (gen1 < 0 || gen2 < 0) return 'Related';

  const isMale = person2Sex === 'M';
  const isFemale = person2Sex === 'F';

  if (gen1 === 0 && gen2 === 0) return 'Self';

  if (gen1 === 1 && gen2 === 0) return isFemale ? 'Mother' : isMale ? 'Father' : 'Parent';
  if (gen1 === 0 && gen2 === 1) return isFemale ? 'Daughter' : isMale ? 'Son' : 'Child';

  if (gen1 >= 2 && gen2 === 0) {
    const greats = gen1 - 2;
    const prefix = getGreatPrefix(greats);
    return isFemale ? `${prefix}Grandmother` : isMale ? `${prefix}Grandfather` : `${prefix}Grandparent`;
  }
  if (gen1 === 0 && gen2 >= 2) {
    const greats = gen2 - 2;
    const prefix = getGreatPrefix(greats);
    return isFemale ? `${prefix}Granddaughter` : isMale ? `${prefix}Grandson` : `${prefix}Grandchild`;
  }

  if (gen1 === 1 && gen2 === 1) return isFemale ? 'Sister' : isMale ? 'Brother' : 'Sibling';

  if (gen1 === 1 && gen2 >= 2) {
    const greats = gen2 - 2;
    const prefix = getGreatPrefix(greats);
    return isFemale ? `${prefix}Niece` : isMale ? `${prefix}Nephew` : `${prefix}Niece/Nephew`;
  }
  if (gen1 >= 2 && gen2 === 1) {
    const greats = gen1 - 2;
    const prefix = getGreatPrefix(greats);
    return isFemale ? `${prefix}Aunt` : isMale ? `${prefix}Uncle` : `${prefix}Aunt/Uncle`;
  }

  if (gen1 >= 2 && gen2 >= 2) {
    const cousinDegree = Math.min(gen1, gen2) - 1;
    const removed = Math.abs(gen1 - gen2);
    let label = `${getOrdinal(cousinDegree)} Cousin`;
    if (removed > 0) {
      label += ` ${removed}x Removed`;
    }
    return label;
  }

  return 'Related';
}

export function isSpouse(
  person1Id: string,
  person2Id: string,
  data: FamilyTreeData
): boolean {
  const person = data.individuals.get(person1Id);
  if (!person) return false;
  for (const famId of person.familiesAsSpouse) {
    const family = data.families.get(famId);
    if (!family) continue;
    if (family.husbandId === person2Id || family.wifeId === person2Id) {
      return true;
    }
  }
  return false;
}

export interface MultiRelationshipEntry {
  relationship: string;
  reverseRelationship: string;
  commonAncestor: CommonAncestorResult;
  totalGenerations: number;
}

export interface MultiRelationshipResult {
  person1: GedcomIndividual;
  person2: GedcomIndividual;
  entries: MultiRelationshipEntry[];
  isSpouse: boolean;
  closestRelationship: string;
  closestReverseRelationship: string;
}

function getSpouseLabel(sex: 'M' | 'F' | 'U'): string {
  if (sex === 'F') return 'Wife';
  if (sex === 'M') return 'Husband';
  return 'Spouse';
}

function findInLawRelationship(
  person1Id: string,
  person2Id: string,
  data: FamilyTreeData,
  spouseIndex: Map<string, string[]>,
  parentIndex: Map<string, string[]>
): { relationship: string; reverseRelationship: string } | null {
  const p2Gender = getGenderSafe(person2Id, data);
  const p1Gender = getGenderSafe(person1Id, data);

  const spouses1 = spouseIndex.get(person1Id) ?? [];
  for (const spouseId of spouses1) {
    const ancestors1 = getAncestorMap(spouseId, data, parentIndex);
    const ancestors2 = getAncestorMap(person2Id, data, parentIndex);
    let bestTotal = Infinity;
    let bestGen1 = 0;
    let bestGen2 = 0;

    ancestors1.forEach((info1, ancestorId) => {
      const info2 = ancestors2.get(ancestorId);
      if (info2) {
        const total = info1.generations + info2.generations;
        if (total > 0 && total < bestTotal) {
          bestTotal = total;
          bestGen1 = info1.generations;
          bestGen2 = info2.generations;
        }
      }
    });

    if (bestTotal < Infinity) {
      const baseRel = describeRelationshipFromGenerations(bestGen1, bestGen2, p2Gender);
      const baseRevRel = describeRelationshipFromGenerations(bestGen2, bestGen1, p1Gender);
      return {
        relationship: `${baseRel}-in-Law`,
        reverseRelationship: `${baseRevRel}-in-Law`,
      };
    }
  }

  const spouses2 = spouseIndex.get(person2Id) ?? [];
  for (const spouseId of spouses2) {
    const ancestors1 = getAncestorMap(person1Id, data, parentIndex);
    const ancestors2 = getAncestorMap(spouseId, data, parentIndex);
    let bestTotal = Infinity;
    let bestGen1 = 0;
    let bestGen2 = 0;

    ancestors1.forEach((info1, ancestorId) => {
      const info2 = ancestors2.get(ancestorId);
      if (info2) {
        const total = info1.generations + info2.generations;
        if (total > 0 && total < bestTotal) {
          bestTotal = total;
          bestGen1 = info1.generations;
          bestGen2 = info2.generations;
        }
      }
    });

    if (bestTotal < Infinity) {
      const baseRel = describeRelationshipFromGenerations(bestGen1, bestGen2, p2Gender);
      const baseRevRel = describeRelationshipFromGenerations(bestGen2, bestGen1, p1Gender);
      return {
        relationship: `${baseRel}-in-Law`,
        reverseRelationship: `${baseRevRel}-in-Law`,
      };
    }
  }

  return null;
}

export function calculateRelationship(
  person1Id: string,
  person2Id: string,
  data: FamilyTreeData
): RelationshipResult | null {
  const person1 = data.individuals.get(person1Id);
  const person2 = data.individuals.get(person2Id);

  if (!person1 || !person2) {
    return null;
  }

  if (person1Id === person2Id) {
    return {
      person1,
      person2,
      relationship: 'Self',
      reverseRelationship: 'Self',
      commonAncestors: [],
      fullPath: [person1Id],
    };
  }

  const commonAncestors = findCommonAncestors(person1Id, person2Id, data);

  if (commonAncestors.length > 0) {
    const closest = commonAncestors[0];
    const person2Gender = getGenderSafe(person2Id, data);
    const person1Gender = getGenderSafe(person1Id, data);
    const relationship = describeRelationshipFromGenerations(
      closest.generationsTo1,
      closest.generationsTo2,
      person2Gender
    );
    const reverseRelationship = describeRelationshipFromGenerations(
      closest.generationsTo2,
      closest.generationsTo1,
      person1Gender
    );

    const path1Reversed = [...closest.pathFromAncestorToPerson1].reverse();
    const path2Tail = closest.pathFromAncestorToPerson2.slice(1);
    const fullPath = [...path1Reversed, ...path2Tail];

    return {
      person1,
      person2,
      relationship,
      reverseRelationship,
      commonAncestors,
      fullPath,
    };
  }

  const spouseRelation = isSpouse(person1Id, person2Id, data);
  if (spouseRelation) {
    return {
      person1,
      person2,
      relationship: getSpouseLabel(getGenderSafe(person2Id, data)),
      reverseRelationship: getSpouseLabel(getGenderSafe(person1Id, data)),
      commonAncestors: [],
      fullPath: [person1Id, person2Id],
    };
  }

  const parentIndex = buildParentIndex(data);
  const spouseIndex = buildSpouseIndex(data);
  const inLaw = findInLawRelationship(person1Id, person2Id, data, spouseIndex, parentIndex);
  if (inLaw) {
    return {
      person1,
      person2,
      relationship: inLaw.relationship,
      reverseRelationship: inLaw.reverseRelationship,
      commonAncestors: [],
      fullPath: [person1Id, person2Id],
    };
  }

  return {
    person1,
    person2,
    relationship: 'No blood relation found',
    reverseRelationship: 'No blood relation found',
    commonAncestors: [],
    fullPath: [],
  };
}

export function calculateAllRelationships(
  person1Id: string,
  person2Id: string,
  data: FamilyTreeData
): MultiRelationshipResult | null {
  const person1 = data.individuals.get(person1Id);
  const person2 = data.individuals.get(person2Id);

  if (!person1 || !person2) return null;

  if (person1Id === person2Id) {
    return {
      person1,
      person2,
      entries: [],
      isSpouse: false,
      closestRelationship: 'Self',
      closestReverseRelationship: 'Self',
    };
  }

  const spouseRelation = isSpouse(person1Id, person2Id, data);
  const allCommon = findAllCommonAncestors(person1Id, person2Id, data);

  const seenRelationships = new Set<string>();
  const entries: MultiRelationshipEntry[] = [];

  const p2Gender = getGenderSafe(person2Id, data);
  const p1Gender = getGenderSafe(person1Id, data);

  for (const ancestor of allCommon) {
    const rel = describeRelationshipFromGenerations(
      ancestor.generationsTo1,
      ancestor.generationsTo2,
      p2Gender
    );
    const revRel = describeRelationshipFromGenerations(
      ancestor.generationsTo2,
      ancestor.generationsTo1,
      p1Gender
    );
    const key = `${rel}|${ancestor.ancestorId}`;
    if (!seenRelationships.has(key)) {
      seenRelationships.add(key);
      entries.push({
        relationship: rel,
        reverseRelationship: revRel,
        commonAncestor: ancestor,
        totalGenerations: ancestor.generationsTo1 + ancestor.generationsTo2,
      });
    }
    if (entries.length >= 20) break;
  }

  let closestRel: string;
  let closestRevRel: string;

  if (entries.length > 0) {
    closestRel = entries[0].relationship;
    closestRevRel = entries[0].reverseRelationship;
  } else if (spouseRelation) {
    closestRel = getSpouseLabel(p2Gender);
    closestRevRel = getSpouseLabel(p1Gender);
  } else {
    const parentIndex = buildParentIndex(data);
    const spouseIndex = buildSpouseIndex(data);
    const inLaw = findInLawRelationship(person1Id, person2Id, data, spouseIndex, parentIndex);
    if (inLaw) {
      closestRel = inLaw.relationship;
      closestRevRel = inLaw.reverseRelationship;
    } else {
      closestRel = 'No blood relation found';
      closestRevRel = 'No blood relation found';
    }
  }

  return {
    person1,
    person2,
    entries,
    isSpouse: spouseRelation,
    closestRelationship: closestRel,
    closestReverseRelationship: closestRevRel,
  };
}

export function getDescendantPath(
  ancestorId: string,
  descendantId: string,
  data: FamilyTreeData
): string[] | null {
  if (!data.individuals.has(ancestorId) || !data.individuals.has(descendantId)) return null;
  if (ancestorId === descendantId) return [ancestorId];

  const childIndex = buildChildIndex(data);
  const visited = new Set<string>();
  const queue: { id: string; path: string[] }[] = [
    { id: ancestorId, path: [ancestorId] },
  ];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.path.length > 30) continue;

    const childIds = childIndex.get(current.id);
    if (!childIds) continue;

    for (const childId of childIds) {
      if (visited.has(childId)) continue;
      const newPath = [...current.path, childId];
      if (childId === descendantId) return newPath;
      queue.push({ id: childId, path: newPath });
    }
  }

  return null;
}
