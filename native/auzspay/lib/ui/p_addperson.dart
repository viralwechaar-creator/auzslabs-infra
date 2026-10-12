import 'package:flutter/material.dart' hide Text;
import '../core/api.dart';
import '../core/calc.dart';
import '../core/session.dart';
import 'i18n.dart';
import 'mk.dart';

/// The structure a new salary is built on, like defaultStructure() on the website: a default one for the basis, else the first active.
String? defaultStructureId(List<Map<String, dynamic>> structures, {String basis = 'monthly'}) {
  final act = structures.where((x) => x['active'] != false).toList();
  Map<String, dynamic>? pick = act.where((x) => x['is_default'] == true && x['basis'] == basis).firstOrNull ?? act.where((x) => x['basis'] == basis).firstOrNull ?? act.firstOrNull;
  return pick == null ? null : '${pick['id']}';
}

/// The payload of pay_save_employee for the short "Add person" form.
Map<String, dynamic> newPersonPayload({
  required String name,
  required String phone,
  required String joinedOn,
  String designation = '',
  String gender = '',
  num salary = 0,
  String? structureId,
  required bool mayEditSalary,
  String payBy = 'cash',
  String accountNo = '',
  String ifsc = '',
  String bankName = '',
}) {
  final p = <String, dynamic>{
    'name': name.trim(),
    'phone': phone.trim(),
    'joined_on': joinedOn,
    'gender': gender.isEmpty ? null : gender,
    'dob': null,
    'email': '',
    'attendance_mode': null,
    'job': {'designation': designation.trim(), 'department': '', 'location_id': null, 'manager_id': null, 'shift_id': null},
  };
  if (mayEditSalary) {
    if (salary > 0) p['salary'] = {'amount': salary, 'structure_id': structureId};
    if (payBy == 'cash') {
      p['bank'] = {'mode': 'cash'};
    } else if (accountNo.trim().isNotEmpty) {
      p['bank'] = {'mode': 'bank', 'account_no': accountNo.trim(), 'ifsc': ifsc.trim().toUpperCase(), 'bank_name': bankName.trim(), 'holder': name.trim()};
    }
  }
  return p;
}

/// Add a person to the payroll. Returns true when saved.
Future<bool> addPerson(BuildContext context, PaySession s) async {
  final name = TextEditingController(), phone = TextEditingController(), job = TextEditingController(), pay = TextEditingController(), acct = TextEditingController(), ifsc = TextEditingController(), bank = TextEditingController();
  var joined = todayStr(), gender = '', payBy = 'cash';
  final sal = s.can('pay_salary');
  var saved = false;
  await openSheet(context, 'Add person', (ctx, set) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Fld('Full name', name, autofocus: true),
        gap(8),
        Fld('Mobile number', phone, phone: true),
        gap(8),
        Fld('Job (e.g. Cook, Cashier)', job),
        gap(8),
        InkWell(
          onTap: () async {
            final d = await showDatePicker(context: ctx, initialDate: DateTime.tryParse(joined) ?? DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime.now().add(const Duration(days: 365)));
            if (d != null) set(() => joined = ymd(d));
          },
          child: InputDecorator(decoration: InputDecoration(labelText: tr('Joined on')), child: Text(fmtD(joined))),
        ),
        gap(8),
        Sel('Gender', gender, [('', tr('Not said')), ('female', tr('Woman')), ('male', tr('Man')), ('other', tr('Other'))], (v) => set(() => gender = v)),
        if (sal) ...[
          gap(8),
          Fld('Monthly salary (₹, before deductions)', pay, number: true),
          gap(8),
          Sel('Salary paid by', payBy, [('cash', tr('Cash')), ('bank', tr('Bank transfer'))], (v) => set(() => payBy = v)),
          if (payBy == 'bank') ...[gap(8), Fld('Account number', acct), gap(8), Fld('IFSC', ifsc), gap(8), Fld('Bank', bank)],
        ],
      ]), actions: [
    SheetAction('Add', (ctx) async {
      if (name.text.trim().isEmpty) {
        toast(ctx, tr('Type the name'), err: true);
        return false;
      }
      try {
        await s.api.rpc('pay_save_employee', {
          'p': newPersonPayload(
            name: name.text, phone: phone.text, joinedOn: joined, designation: job.text, gender: gender, salary: num.tryParse(pay.text.replaceAll(',', '')) ?? 0,
            structureId: defaultStructureId(((s.ctx['structures'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList()), mayEditSalary: sal, payBy: payBy, accountNo: acct.text, ifsc: ifsc.text, bankName: bank.text)
        });
        saved = true;
        return true;
      } on ApiError catch (e) {
        if (ctx.mounted) toast(ctx, e.message, err: true);
        return false;
      }
    }),
  ]);
  return saved;
}
