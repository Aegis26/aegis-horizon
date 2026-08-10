import { create } from 'zustand';

interface OrgStore {
  selectedOrgId: string | null;
  setSelectedOrgId: (id: string | null) => void;
}

export const useOrgStore = create<OrgStore>((set) => ({
  selectedOrgId: localStorage.getItem('meridian_org_id'),
  setSelectedOrgId: (id) => {
    if (id) {
      localStorage.setItem('meridian_org_id', id);
    } else {
      localStorage.removeItem('meridian_org_id');
    }
    set({ selectedOrgId: id });
  },
}));
