import { createContext, useContext } from 'react';

// me (clinic, access, ai, product), refs (practitioners, services), helpers (money, canWrite, refresh)
export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const STATUS = { scheduled: 'Scheduled', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' };
export const INV_STATUS = { unpaid: 'Unpaid', partial: 'Part paid', paid: 'Paid' };
export const PAY_METHODS = ['Cash', 'Card', 'Bank transfer', 'Insurance', 'Mobile wallet', 'Cheque', 'Other'];
export const EXPENSE_CATS = ['Rent', 'Salaries', 'Medical supplies', 'Equipment', 'Lab fees', 'Utilities', 'Marketing', 'Insurance', 'Software', 'Maintenance', 'Other'];
export const CLINIC_TYPES = { dental: 'Dental clinic', therapy: 'Therapy / counselling', physio: 'Physiotherapy', general: 'General practice / medical', other: 'Other' };
export const DOC_CATEGORIES = ['Lab report', 'Prescription', 'X-ray / scan', 'ID / insurance card', 'Referral letter', 'Consent form', 'Registration form', 'Invoice / receipt', 'Other'];

export const go = (hash) => { window.location.hash = hash; };
