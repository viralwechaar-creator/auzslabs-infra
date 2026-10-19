/// Identifies a cart line for merge purposes -- exact port of lineKey() in the website's pos/core.js.
/// Two lines are "the same line" (their quantities should combine rather than sit as two separate
/// rows) only when they share this key AND the same price; callers must still compare price
/// themselves, same as every website call site does.
String lineKey(Map<String, dynamic> l) => '${l['id'] ?? ''}|${l['size'] ?? ''}|${l['note'] ?? ''}';
