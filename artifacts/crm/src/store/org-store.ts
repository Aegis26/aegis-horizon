import { create } from 'zustand';

interface OrgStore {
  selectedOrgId: string | null;
  setSelectedOrgId: (id: string | null) => void;
}

export const useOrgStore = create<OrgStore>((set) => ({
  // Workspace selection is a per-window preference; localStorage would leak
  // an organization choice into independently authenticated windows.
  selectedOrgId: sessionStorage.getItem('meridian_org_id'),
  setSelectedOrgId: (id) => {
    if (id) {
      sessionStorage.setItem('meridian_org_id', id);
    } else {
      sessionStorage.removeItem('meridian_org_id');
    }
    set({ selectedOrgId: id });
  },
}));
