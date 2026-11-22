import {inflateRawSync} from 'node:zlib';

const manifest = 'auzslab-theme.json';
export const packageLimit = 2 * 1024 * 1024;
const manifestLimit = 256 * 1024;
const pageIds = new Set(['home','product','collection','collections','page','stores','about','contact','cart','search','blog','article','password','giftcard','notfound','header','footer']);
const sectionTypes = new Set(['Hero','Product row','Collection slider','Product details','Store cards','Stores directory','Store footer','Text','Image','Newsletter','Announcement','Navigation','FAQ','Testimonials','Contact form','Divider']);
const blockTypes = new Set(['Heading','Text','Button','Image','Divider','Store location','Footer link']);
const blockFields = new Set(['id','type','title','text','image','href','hidden','address','hours','phone','group']);
const sectionFields = new Set([...blockFields,'mobileImage','cta','source','count','desktop','mobile','layout','mobileLayout','spacing','align','selected','blocks','brand','helpLabel']);

function extractManifest(bytes) {
  const eof = bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(eof<0||eof+22>bytes.length||bytes.readUInt16LE(eof+4)||bytes.readUInt16LE(eof+6)||bytes.readUInt16LE(eof+10)!==1) {
    throw new Error('The theme ZIP must contain one auzslab-theme.json file at the root.');
  }
  const central=bytes.readUInt32LE(eof+16);
  if(central+46>eof||bytes.readUInt32LE(central)!==0x02014b50)throw new Error('Invalid ZIP directory.');
  const nameLength=bytes.readUInt16LE(central+28);
  if(central+46+nameLength>eof||bytes.toString('utf8',central+46,central+46+nameLength)!==manifest)throw new Error('Expected auzslab-theme.json at the root.');
  const entry=bytes.readUInt32LE(central+42),method=bytes.readUInt16LE(central+10);
  const size=bytes.readUInt32LE(central+20), uncompressed=bytes.readUInt32LE(central+24);
  if(bytes.readUInt16LE(central+8)&1||uncompressed>manifestLimit||entry+30>central||bytes.readUInt32LE(entry)!==0x04034b50)throw new Error('Invalid or oversized theme manifest.');
  const start=entry+30+bytes.readUInt16LE(entry+26)+bytes.readUInt16LE(entry+28);
  if(start+size>central||![0,8].includes(method))throw new Error('Unsupported theme ZIP compression.');
  const compressed=bytes.subarray(start,start+size);
  const data=method===0?compressed:inflateRawSync(compressed,{maxOutputLength:manifestLimit});
  if(data.length!==uncompressed)throw new Error('Invalid theme manifest size.');
  return JSON.parse(data.toString('utf8'));
}

function readEntry(entry, types, keys) {
  if(!entry||!types.has(entry.type)||typeof entry.title!=='string'||typeof entry.id!=='string'||!/^[-_a-zA-Z0-9]{1,80}$/.test(entry.id)) {
    throw new Error('Each section or block needs a supported type, title, and identifier.');
  }
  return Object.fromEntries(Object.entries(entry).filter(([key,value])=>
    keys.has(key)&&(
      typeof value==='string'&&value.length<=6000 ||
      typeof value==='boolean' ||
      typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100 ||
      key==='selected'&&Array.isArray(value)&&value.length<=100&&value.every(id=>typeof id==='string'&&id.length<=80)
    )));
}
function readElements(elements){
  if(!elements||Array.isArray(elements)||typeof elements!=='object')return undefined;
  return Object.fromEntries(Object.entries(elements).slice(0,200).filter(([key,value])=>/^(section|h[1-4]|p|a|button|img)\.\d{1,4}$/.test(key)&&value&&typeof value==='object').map(([key,value])=>[key,Object.fromEntries(
    Object.entries(value).filter(([field,setting])=>['text','href'].includes(field)?typeof setting==='string'&&setting.length<=6000:field==='size'&&Number.isFinite(setting)&&setting>=8&&setting<=(key.startsWith('img.')?1600:key.startsWith('section.')?300:120))
  )]));
}

export function readThemePackage(bytes) {
  const theme=extractManifest(bytes);
  if(theme?.version!==1||!['minimal','classic'].includes(theme.theme)||!theme.pages||Array.isArray(theme.pages)) {
    throw new Error('Use an AUZslab version 1 theme package based on Minimal or Classic.');
  }
  const pages=Object.fromEntries(Object.entries(theme.pages).map(([id,sections])=>{
    if(!pageIds.has(id)||!Array.isArray(sections)||sections.length>30||new Set(sections.map(s=>s?.id)).size!==sections.length)throw new Error('Invalid page template or duplicate section identifiers.');
    return [id,sections.map(section=>{
      const clean=readEntry(section,sectionTypes,sectionFields);
      if(section.elements)clean.elements=readElements(section.elements);
      const blocks=section.blocks||[];
      if(!Array.isArray(blocks)||blocks.length>20||new Set(blocks.map(b=>b?.id)).size!==blocks.length)throw new Error('Invalid blocks or duplicate block identifiers.');
      clean.blocks=blocks.map(block=>readEntry(block,blockTypes,blockFields));
      return clean;
    })];
  }));
  return {theme:theme.theme,pages,
    accent:typeof theme.accent==='string'&&/^#[\da-f]{6}$/i.test(theme.accent)?theme.accent:'#252525',
    radius:typeof theme.radius==='number'&&Number.isFinite(theme.radius)?Math.min(40,Math.max(0,theme.radius)):6,
    font:typeof theme.font==='string'&&['Theme default','System sans','Editorial serif','Monospace'].includes(theme.font)?theme.font:'Theme default'};
}

export function starterThemePackage(design) {
  const {theme,pages,accent,radius,font}=design;
  const contents=Buffer.from(JSON.stringify({version:1,theme,pages,accent,radius,font},null,2));
  const name=Buffer.from(manifest);
  let crc=0xffffffff;
  for(const byte of contents){
    crc^=byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE((~crc)>>>0,14);
  local.writeUInt32LE(contents.length,18);local.writeUInt32LE(contents.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE((~crc)>>>0,16);
  central.writeUInt32LE(contents.length,20);central.writeUInt32LE(contents.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
  end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+contents.length,16);
  return Buffer.concat([local,name,contents,central,name,end]);
}
