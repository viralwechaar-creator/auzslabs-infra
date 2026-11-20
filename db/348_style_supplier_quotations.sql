-- Supplier quotations are reference documents and do not affect payables or GST.
alter table sty_supplier_notes drop constraint sty_supplier_notes_kind_check;
alter table sty_supplier_notes add constraint sty_supplier_notes_kind_check
  check (kind in ('credit', 'debit', 'quotation'));
