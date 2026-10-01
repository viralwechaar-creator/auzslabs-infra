/* AUZslab FX drawing library: stroke-only pencil illustrations as SVG markup (viewBox 0 0 240 200).
   Used by fx.js for [data-art] elements, particle shapes and scene props. */
(function () {
  'use strict';
  function gear(cx, cy, r1, r2, n) { // toothed outline as one path
    var d = '', a, i, step = Math.PI * 2 / n;
    for (i = 0; i < n; i++) {
      a = i * step;
      var p = [[a, r1], [a + step * .18, r2], [a + step * .5, r2], [a + step * .68, r1]];
      p.forEach(function (q, j) { d += (i === 0 && j === 0 ? 'M' : 'L') + (cx + Math.cos(q[0]) * q[1]).toFixed(1) + ' ' + (cy + Math.sin(q[0]) * q[1]).toFixed(1) + ' '; });
    }
    return d + 'Z';
  }
  function spark(x, y, s, cls) { // four-point star
    var pts = [[0, -1], [.28, -.28], [1, 0], [.28, .28], [0, 1], [-.28, .28], [-1, 0], [-.28, -.28]];
    return '<path class="' + (cls || 'a') + ' tw" d="M' + pts.map(function (p) { return (x + p[0] * s).toFixed(1) + ' ' + (y + p[1] * s).toFixed(1); }).join('L') + 'Z"/>';
  }

  var ART = {
    pos: '<rect class="f" x="48" y="98" width="144" height="70" rx="8"/><rect class="f" x="66" y="54" width="108" height="46" rx="6"/><path class="a" d="M80 68h50M80 80h32M80 90h44"/><path d="M150 66h14M150 76h14"/>' +
      '<path class="f" d="M92 54V26l8 6 8-6 8 6 8-6 8 6 8-6v28"/><path class="h" d="M100 40h36M100 47h24"/>' +
      '<rect x="66" y="114" width="22" height="14" rx="3"/><rect x="96" y="114" width="22" height="14" rx="3"/><rect x="126" y="114" width="22" height="14" rx="3"/><rect x="66" y="136" width="22" height="14" rx="3"/><rect x="96" y="136" width="22" height="14" rx="3"/><circle class="a" cx="168" cy="136" r="10"/><path d="M48 168h144"/><path class="h" d="M58 178h124"/>' +
      '<circle class="f" cx="210" cy="56" r="15"/><path class="a" d="M203 56h14M210 49v14"/>' + spark(30, 50, 10) + spark(206, 150, 7),
    crm: '<path class="f" d="M150 14h56a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8h-30l-10 10V54h-16a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z"/><path class="a" d="M182 46C162 34 168 22 182 30C196 22 202 34 182 46z"/>' +
      '<circle class="f" cx="86" cy="86" r="21"/><path class="f" d="M44 170c0-30 19-46 42-46s42 16 42 46z"/><path d="M78 92q8 7 16 0"/><circle class="f" cx="162" cy="102" r="16"/><path class="f" d="M130 172c0-22 14-36 32-36s32 14 32 36z"/><path class="h" d="M100 70q10-12 26-8"/>' + spark(40, 40, 9) + spark(214, 130, 8),
    billing: '<path class="f" d="M62 22h86l30 30v126H62z"/><path d="M148 22v30h30"/><path d="M80 72h62M80 88h62M80 104h42"/><path class="h" d="M80 124h84"/><path d="M80 148h50"/><path class="a" d="M80 158h50"/>' +
      '<g transform="rotate(-14 166 142)"><circle class="a f" cx="166" cy="142" r="28"/><path class="a" d="M153 142l9 9 17-20"/></g>' + spark(30, 60, 9) + spark(212, 44, 7),
    inventory: '<rect class="f" x="36" y="122" width="72" height="56" rx="3"/><path d="M36 140h72M64 122v18M80 122v18"/><rect class="f" x="114" y="122" width="72" height="56" rx="3"/><path d="M114 140h72M142 122v18M158 122v18"/><rect class="f" x="76" y="66" width="76" height="54" rx="3"/><path d="M76 84h76M104 66v18M120 66v18"/>' +
      '<path class="a" d="M196 70v32M202 70v32M210 70v32M218 70v32M224 70v32" transform="translate(-10 -12) scale(.92)"/><path class="a" d="M206 116V92m-9 10l9-10 9 10"/><path class="h" d="M20 182h200"/>' + spark(34, 70, 9),
    qr: '<rect class="f" x="78" y="16" width="84" height="162" rx="14"/><path d="M108 27h24"/><rect x="92" y="54" width="22" height="22"/><rect x="126" y="54" width="22" height="22"/><rect x="92" y="88" width="22" height="22"/><rect class="a" x="98" y="60" width="10" height="10"/><rect class="a" x="132" y="60" width="10" height="10"/><rect class="a" x="98" y="94" width="10" height="10"/>' +
      '<path d="M126 90h6M140 90h8M126 100h10M142 100h6M92 124h14M112 124h8M126 124h22M92 136h8M108 136h16M132 136h16M92 148h26M126 148h22"/><path class="a" d="M50 72q-16 28 0 56M34 58q-28 42 0 84"/><path class="a" d="M190 72q16 28 0 56M206 58q28 42 0 84"/>',
    website: '<rect class="f" x="26" y="30" width="188" height="142" rx="10"/><path d="M26 56h188"/><circle cx="42" cy="43" r="3.5"/><circle class="a" cx="54" cy="43" r="3.5"/><circle cx="66" cy="43" r="3.5"/>' +
      '<path d="M40 76h76M40 92h60M40 108h68"/><rect class="f" x="128" y="68" width="72" height="56" rx="4"/><path class="a" d="M132 116l18-22 14 14 10-10 20 18"/><circle cx="182" cy="82" r="6"/><path d="M40 140h40M40 152h28"/><rect class="a" x="128" y="136" width="46" height="18" rx="9"/>' +
      '<path class="f" d="M178 150v26l7-6 6 12 6-3-6-12 9-1z"/>' + spark(222, 30, 8),
    payroll: '<rect class="f" x="30" y="44" width="116" height="124" rx="8"/><path d="M30 72h116M58 34v18M118 34v18"/><path d="M50 92h10M74 92h10M98 92h10M122 92h10M50 112h10M74 112h10M98 112h10M122 112h10M50 132h10M74 132h10"/><path class="a" d="M96 132l8 8 15-17"/>' +
      '<ellipse class="f" cx="188" cy="152" rx="26" ry="9"/><path d="M162 152v14a26 9 0 0 0 52 0v-14"/><ellipse class="f" cx="188" cy="136" rx="26" ry="9"/><path d="M162 136v16M214 136v16"/><ellipse class="f" cx="188" cy="120" rx="26" ry="9"/><path class="a" d="M182 120h12"/>' +
      '<circle class="f" cx="186" cy="62" r="22"/><path class="a" d="M186 48v14l10 6"/>' + spark(40, 22, 8),
    booking: '<rect class="f" x="30" y="40" width="128" height="132" rx="8"/><path d="M30 70h128M62 28v20M126 28v20"/><path d="M48 92h12M72 92h12M96 92h12M120 92h12M48 114h12M72 114h12M120 114h12M48 136h12M72 136h12M96 136h12"/><circle class="a" cx="102" cy="120" r="14"/>' +
      '<rect class="f" x="170" y="60" width="50" height="22" rx="6"/><rect class="f" x="170" y="92" width="50" height="22" rx="6"/><path class="a" d="M178 71h20M178 103h28"/><circle class="f" cx="196" cy="150" r="22"/><path class="a" d="M196 136v14l9 6"/>' + spark(214, 30, 8),
    salon: '<circle class="f" cx="74" cy="142" r="19"/><circle class="f" cx="118" cy="148" r="19"/><path d="M84 127L176 42M108 133L190 64"/><path class="a" d="M176 42l14 22"/>' +
      '<rect class="f" x="26" y="42" width="92" height="22" rx="4"/><path d="M36 64v14M48 64v14M60 64v14M72 64v14M84 64v14M96 64v14M108 64v14"/><circle class="f" cx="190" cy="138" r="26"/><path d="M190 164v26"/><path class="a" d="M178 128q8-8 18-4"/>' + spark(214, 30, 9),
    cafe: '<path class="f" d="M56 90h100v34a50 50 0 0 1-100 0z"/><path d="M156 100h14a16 16 0 0 1 0 32h-18"/><ellipse class="f" cx="106" cy="180" rx="70" ry="9"/><path class="a" d="M84 72c-10-12 10-18 0-32M110 72c-10-12 10-18 0-32M136 72c-10-12 10-18 0-32"/>' +
      '<ellipse class="f" cx="198" cy="160" rx="13" ry="8" transform="rotate(-30 198 160)"/><path d="M189 164q10-9 17-8"/><ellipse class="f" cx="36" cy="150" rx="11" ry="7" transform="rotate(25 36 150)"/>' + spark(30, 70, 8),
    retail: '<path class="f" d="M58 74h124l10 104H48z"/><path d="M90 74V60a30 30 0 0 1 60 0v14"/><circle cx="96" cy="88" r="3.5"/><circle cx="144" cy="88" r="3.5"/><path class="a f" d="M156 112h40l16 18-16 18h-40z"/><circle cx="168" cy="130" r="3.5"/><path class="h" d="M170 130C160 110 148 120 140 100"/><path class="h" d="M70 150h70"/>' + spark(30, 46, 9) + spark(214, 60, 7),
    platform: '<path class="f" d="M120 38l58 29v66l-58 29-58-29V67z"/><path d="M62 67l58 29 58-29M120 96v66"/><path class="a" d="M91 52l58 29"/>' +
      '<circle class="f" cx="30" cy="50" r="11"/><circle class="f" cx="210" cy="56" r="11"/><circle class="f" cx="30" cy="152" r="11"/><circle class="f" cx="210" cy="150" r="11"/><path class="h" d="M41 54L66 70M199 61L178 70M41 148L66 132M199 146L178 132"/>' + spark(120, 14, 8),
    megaphone: '<path class="f" d="M52 100l92-46v112L52 132z"/><rect class="f" x="28" y="98" width="26" height="36" rx="6"/><path d="M70 136l10 36h22l-8-34"/><path class="a" d="M158 84q16 16 0 32M174 70q26 30 0 60M190 56q36 44 0 88"/>' + spark(200, 30, 10) + spark(34, 60, 8) + spark(214, 168, 7),
    gear: '<path class="f" d="' + gear(112, 98, 50, 62, 12) + '"/><circle class="f" cx="112" cy="98" r="32"/><circle class="a" cx="112" cy="98" r="14"/><path class="f" d="' + gear(184, 158, 22, 30, 8) + '"/><circle cx="184" cy="158" r="10"/>' + spark(200, 40, 9) + spark(30, 160, 7),
    monitor: '<rect class="f" x="28" y="28" width="184" height="118" rx="8"/><path d="M96 170h48M120 146v24"/><path class="a f" d="M104 66l42 23-42 23z"/><path d="M46 130h148"/><path class="a" d="M46 130h74"/>' + spark(222, 20, 8) + spark(24, 168, 7),
    growth: '<path d="M26 176h190"/><rect class="f" x="42" y="132" width="30" height="44"/><rect class="f" x="86" y="106" width="30" height="70"/><rect class="f" x="130" y="78" width="30" height="98"/><rect class="f" x="174" y="46" width="30" height="130"/><path class="h" d="M48 150l18-10M48 164l18-10M92 128l18-10M92 144l18-10M136 100l18-10M136 118l18-10M180 70l18-10M180 90l18-10"/>' +
      '<path class="a" d="M34 112L98 76l36-8 66-40M178 28h24v24"/>',
    rocket: '<path class="f" d="M120 20c30 24 40 66 27 112H93C80 86 90 44 120 20z"/><circle class="f" cx="120" cy="76" r="15"/><path class="f" d="M93 110l-30 34 30-3zM147 110l30 34-30-3z"/><path class="a" d="M107 136q13 44 13 44t13-44"/>' + spark(40, 50, 9) + spark(204, 70, 8) + spark(190, 168, 7),
    envelope: '<rect class="f" x="30" y="68" width="172" height="106" rx="10"/><path d="M30 76l86 62 86-62"/><path class="a f" d="M148 34l60-22-24 62-16-22z"/><path class="a" d="M184 54l24-42"/><path class="h" d="M26 44q46-24 86 4"/>' + spark(30, 30, 8),
    tag: '<path class="f" d="M38 104l62-62h78v78l-62 62z"/><circle cx="150" cy="70" r="8"/><path d="M150 62C150 38 122 28 112 10"/><path class="a" d="M88 124l52-52"/><path class="h" d="M78 146l70-70"/>' + spark(40, 40, 9) + spark(208, 168, 8)
  };
  ART.crate = '<rect class="f" x="36" y="56" width="168" height="120" rx="4"/><path d="M36 90h168M120 56v34"/><path class="a" d="M64 124h46M64 142h78"/><path class="h" d="M48 166h144"/><rect class="a" x="150" y="112" width="34" height="34" rx="3"/>';
  ART['default'] = ART.platform;
  window.FXART = { ART: ART, gear: gear, spark: spark };
})();
