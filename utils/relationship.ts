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

const MAX_GENERATIONS = 20;

function buildParentIndex(data: FamilyTreeData): Map<string, string[]> {
  const parentIndex = new Map<string, string[]>();

  data.individuals.forEach((person) => {
    if (person.familyAsChild) {
      const family = data.families.get(person.familyAsChild);
      if (family) {
        const parents: string[] = [];
        if (family.husbandId && data.individuals.has(family.husbandId)) parents.push(family.husbandId);
        if (family.wifeId && data.individuals.has(family.wifeId)) parents.push(family.wifeId);
        if (parents.length > 0) {
          parentIndex.set(person.id, parents);
        }
      }
    }
  });

  data.families.forEach((family) => {
    const parents: string[] = [];
    if (family.husbandId && data.individuals.has(family.husbandId)) parents.push(family.husbandId);
    if (family.wifeId && data.individuals.has(family.wifeId)) parents.push(family.wifeId);
    if (parents.length === 0) return;

    for (const childId of family.childrenIds) {
      if (!data.individuals.has(childId)) continue;
      const existing = parentIndex.get(childId);
      if (!existing) {
        parentIndex.set(childId, [...parents]);
      } else {
        for (const pid of parents) {
          if (!existing.includes(pid)) {
            existing.push(pid);
          }
        }
      }
    }
  });

  return parentIndex;
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

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current.id)) continue;

    ancestors.set(current.id, {
      generations: current.generations,
      path: [...current.path],
    });

    if (earlyExitId && current.id === earlyExitId && current.generations > 0) {
      return ancestors;
    }

    if (current.generations >= MAX_GENERATIONS) continue;

    const parentIds = parentIndex.get(current.id) ?? [];
    for (const pid of parentIds) {
      if (!ancestors.has(pid)) {
        queue.push({
          id: pid,
          generations: current.generations + 1,
          path: [...current.path, pid],
        });
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
    return totalA - totalB;
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

    const path1 = [...closest.pathFromAncestorToPerson1];
    const path2 = closest.pathFromAncestorToPerson2.slice(1);
    const fullPath = [...path1, ...path2];



    return {
      person1,
      person2,
      relationship,
      reverseRelationship,
      commonAncestors,
      fullPath,
    };
  }

  if (isSpouse(person1Id, person2Id, data)) {
    return {
      person1,
      person2,
      relationship: getGenderSafe(person2Id, data) === 'F' ? 'Wife' : getGenderSafe(person2Id, data) === 'M' ? 'Husband' : 'Spouse',
      reverseRelationship: getGenderSafe(person1Id, data) === 'F' ? 'Wife' : getGenderSafe(person1Id, data) === 'M' ? 'Husband' : 'Spouse',
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

  const closestRel = entries.length > 0 ? entries[0].relationship : (spouseRelation ? (p2Gender === 'F' ? 'Wife' : p2Gender === 'M' ? 'Husband' : 'Spouse') : 'No blood relation found');
  const closestRevRel = entries.length > 0 ? entries[0].reverseRelationship : (spouseRelation ? (p1Gender === 'F' ? 'Wife' : p1Gender === 'M' ? 'Husband' : 'Spouse') : 'No blood relation found');



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
  if (ancestorId === descendantId) return [ancestorId];

  const visited = new Set<string>();
  const queue: { id: string; path: string[] }[] = [
    { id: ancestorId, path: [ancestorId] },
  ];

  const childrenCache = new Map<string, string[]>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    if (current.path.length > 30) continue;

    let childIds = childrenCache.get(current.id);
    if (!childIds) {
      childIds = [];
      const person = data.individuals.get(current.id);
      if (person) {
        for (const famId of person.familiesAsSpouse) {
          const family = data.families.get(famId);
          if (family) {
            for (const cId of family.childrenIds) {
              childIds.push(cId);
            }
          }
        }
      }
      childrenCache.set(current.id, childIds);
    }

    for (const childId of childIds) {
      if (visited.has(childId)) continue;
      const newPath = [...current.path, childId];
      if (childId === descendantId) return newPath;
      queue.push({ id: childId, path: newPath });
    }
  }

  return null;
}
