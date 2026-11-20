export const supplierAccountSample = {
  bought: 22000, paid: 14000, creditNotes: 900, debitNotes: 450,
  invoices: [
    { id: 'sample-a', reference: 'INV-1042', at: '2026-11-18T09:00:00Z', total: 12000, paid: 4000, units: 24, item: 'Straight-leg denim' },
    { id: 'sample-b', reference: 'INV-1028', at: '2026-11-12T09:00:00Z', total: 10000, paid: 10000, units: 20, item: 'Cotton overshirts' },
  ],
  payments: [
    { reference: 'INV-1042', at: '2026-11-18T09:00:00Z', amount: 4000, mode: 'bank' },
    { reference: 'INV-1028', at: '2026-11-12T09:00:00Z', amount: 10000, mode: 'upi' },
  ],
  notes: [
    { kind: 'quotation', reference: 'QT-021', issued_on: '2026-11-10', amount: 10000, reason: 'Quote for 20 cotton overshirts' },
    { kind: 'credit', reference: 'CN-031', issued_on: '2026-11-19', invoice_reference: 'INV-1042', amount: 900, reason: 'Supplier price allowance' },
    { kind: 'debit', reference: 'DN-008', issued_on: '2026-11-20', invoice_reference: 'INV-1042', amount: 450, reason: 'Short delivery claim' },
  ],
};
