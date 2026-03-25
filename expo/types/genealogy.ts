export interface GedcomIndividual {
  id: string;
  name: string;
  givenName: string;
  surname: string;
  sex: 'M' | 'F' | 'U';
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  familiesAsSpouse: string[];
  familyAsChild?: string;
  occupation?: string;
  note?: string;
}

export interface GedcomFamily {
  id: string;
  husbandId?: string;
  wifeId?: string;
  childrenIds: string[];
  marriageDate?: string;
  marriagePlace?: string;
}

export interface FamilyTreeData {
  individuals: Map<string, GedcomIndividual>;
  families: Map<string, GedcomFamily>;
}

export interface SearchHistoryItem {
  id: string;
  type: 'search' | 'relationship';
  query: string;
  resultCount: number;
  timestamp: number;
  selectedPersonId?: string;
  selectedPersonName?: string;
  person1Id?: string;
  person1Name?: string;
  person2Id?: string;
  person2Name?: string;
  relationshipResult?: string;
  pathCount?: number;
}

export interface UserProfile {
  id: string;
  displayName: string;
  email?: string;
  rootPersonId?: string;
  rootPersonName?: string;
  createdAt: number;
  avatarInitials?: string;
}

export interface RelationshipPath {
  path: string[];
  description: string;
}

export type PendingEditType = 'update_person' | 'add_person' | 'add_child' | 'add_spouse' | 'link_spouses' | 'edit_marriage';
export type PendingEditStatus = 'pending' | 'approved' | 'rejected';

export interface PendingEdit {
  id: string;
  tree_id: string;
  edit_type: PendingEditType;
  target_id: string;
  data: Record<string, unknown>;
  submitted_by: string;
  submitted_at: string;
  status: PendingEditStatus;
  reviewed_at?: string;
  reviewer_note?: string;
}
