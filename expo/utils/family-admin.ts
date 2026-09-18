import type { FamilyTreeData, GedcomFamily, GedcomIndividual } from '@/types/genealogy';

export function parentKey(family: Pick<GedcomFamily, 'husbandId' | 'wifeId'>): string | null {
  const husband = family.husbandId?.trim() || '';
  const wife = family.wifeId?.trim() || '';
  if (!husband && !wife) return null;
  return `${husband}|${wife}`;
}

export function findDuplicateFamilyGroups(data: FamilyTreeData): GedcomFamily[][] {
  const groups = new Map<string, GedcomFamily[]>();
  data.families.forEach((family) => {
    const key = parentKey(family);
    if (!key) return;
    const list = groups.get(key);
    if (list) list.push(family);
    else groups.set(key, [family]);
  });
  return Array.from(groups.values()).filter((group) => group.length > 1);
}

export function personFamilyMap(
  personId: string,
  data: FamilyTreeData
): {
  asChild: GedcomFamily | null;
  asSpouse: Array<{
    family: GedcomFamily;
    spouse: GedcomIndividual | null;
    children: GedcomIndividual[];
  }>;
} {
  const person = data.individuals.get(personId);
  const asChildId = person?.familyAsChild;
  const asChild = asChildId ? data.families.get(asChildId) ?? null : null;

  const asSpouse = (person?.familiesAsSpouse ?? [])
    .map((familyId) => data.families.get(familyId))
    .filter((family): family is GedcomFamily => !!family)
    .map((family) => {
      const resolvedSpouseId =
        family.husbandId === personId
          ? family.wifeId
          : family.wifeId === personId
            ? family.husbandId
            : undefined;
      return {
        family,
        spouse: resolvedSpouseId ? data.individuals.get(resolvedSpouseId) ?? null : null,
        children: family.childrenIds
          .map((id) => data.individuals.get(id))
          .filter((child): child is GedcomIndividual => !!child),
      };
    });

  return { asChild, asSpouse };
}

export function consolidateDuplicateFamilies(data: FamilyTreeData): {
  individuals: Map<string, GedcomIndividual>;
  families: Map<string, GedcomFamily>;
  mergedAway: string[];
} {
  const individuals = new Map(data.individuals);
  const families = new Map(data.families);
  const mergedAway: string[] = [];
  const groups = findDuplicateFamilyGroups({ individuals, families });

  for (const group of groups) {
    const sorted = [...group].sort((a, b) => {
      const childDiff = b.childrenIds.length - a.childrenIds.length;
      if (childDiff !== 0) return childDiff;
      return a.id.localeCompare(b.id);
    });
    const keep = sorted[0];
    const keepChildren = new Set(keep.childrenIds);

    for (let i = 1; i < sorted.length; i++) {
      const dup = sorted[i];
      for (const childId of dup.childrenIds) keepChildren.add(childId);
      families.delete(dup.id);
      mergedAway.push(dup.id);

      individuals.forEach((person, personId) => {
        let next = person;
        const spouseList = Array.isArray(person.familiesAsSpouse) ? person.familiesAsSpouse : [];
        if (spouseList.includes(dup.id)) {
          next = {
            ...next,
            familiesAsSpouse: Array.from(
              new Set(spouseList.map((id) => (id === dup.id ? keep.id : id)))
            ),
          };
        }
        if (person.familyAsChild === dup.id) {
          next = { ...next, familyAsChild: keep.id };
        }
        if (next !== person) individuals.set(personId, next);
      });
    }

    families.set(keep.id, { ...keep, childrenIds: Array.from(keepChildren) });
  }

  return { individuals, families, mergedAway };
}

export function displayName(person: GedcomIndividual | null | undefined, fallback = 'Unknown'): string {
  if (!person) return fallback;
  return person.name?.trim() || [person.givenName, person.surname].filter(Boolean).join(' ') || person.id;
}
