import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildResultsSummary, readableKey} from '../src/services/StudyResultSummary.ts';
const metadata={name:'test.json',uploadedAt:'2026-09-06T10:00:00Z'};
const make=(id='r1')=>({schemaVersion:"2.0",participantId:"P001",resultId:id,sessionId:'same',questionnaire:metadata,sections:[{name:'participant_information',title:'Participant profile',responses:{age:'A'}}],captures:[1,2].map(id=>({id,reflection:{choice:'A',multi:['Sight','Sight','Sound'],rating:String(id),matrix:{comfort:id,intensity:3},comment:id===1?'  ':'Quiet place'}}))});
const definitions=[{metadata,survey:{pages:[{name:'participant_information',title:'Participant profile',elements:[{name:'age',type:'dropdown',title:'Age Range'}]},{name:'__capture_template__',elements:[{name:'choice',type:'radiogroup',title:'Source'},{name:'multi',type:'checkbox',title:'Senses'},{name:'rating',type:'rating',title:'Rating',rateValues:[3,2,1]},{name:'matrix',type:'matrix',title:'Moment evaluation',rows:[{value:'intensity',text:'Intensity'},{value:'comfort',text:'Comfort'}],columns:[1,2,3]},{name:'comment',type:'comment',title:'Why?'}]}]}}];
const section=(results,name='Captured moments',defs=definitions)=>buildResultsSummary(results,defs)[0].sections.find(s=>s.label===name);
const answer=(results,key)=>section(results).questions.find(q=>q.key===key).answers[0];
test('participant counts once per result and captures once per capture; repeated sessions remain distinct',()=>{
 const results=[make(),make('r2')]; assert.equal(section(results,'Participant profile').questions[0].answers[0].count,2); assert.equal(answer(results,'choice').count,4);
});
test('single choice excludes missing answers and calculates percentages',()=>{
 const r=make();r.captures.push({id:3,reflection:{choice:'B'}},{id:4,reflection:{}});
 const d=answer([r],'choice').distribution;assert.deepEqual(d.map(v=>v.count),[2,1]);assert.ok(Math.abs(d[0].percent-200/3)<1e-10);assert.ok(Math.abs(d[1].percent-100/3)<1e-10);
});
test('checkbox deduplicates selections and divides by nonempty observations',()=>{
 const r=make();r.captures[1].reflection.multi=['Sight'];r.captures.push({id:3,reflection:{multi:[]}});
 const a=answer([r],'multi');assert.equal(a.count,2);assert.equal(a.kind,'multi');assert.deepEqual(a.distribution.map(d=>[d.label,d.count,d.percent]),[['Sight',2,100],['Sound',1,50]]);
});
test('ratings respect defined order and numeric strings',()=>{
 const a=answer([make()],'rating'); assert.deepEqual(a.distribution.map(d=>d.label),['3','2','1']);assert.equal(a.average,1.5);assert.deepEqual(a.distribution.map(d=>d.count),[0,1,1]);
});
test('matrix rows retain titles, order and distinct distributions under parent',()=>{
 const q=section([make()]).questions.find(q=>q.key==='matrix');assert.equal(q.title,'Moment evaluation');assert.deepEqual(q.answers.map(a=>a.title),['Intensity','Comfort']);assert.equal(q.answers[0].average,3);assert.equal(q.answers[1].average,1.5);
});
test('empty free text excluded, original UTF-8 and result/capture context retained',()=>{
 const r=make();r.captures[1].reflection.comment='Espaço tranquilo — café 🌳';const a=answer([r],'comment');assert.equal(a.count,1);assert.equal(a.kind,'text');assert.deepEqual(a.observations[0],{value:'Espaço tranquilo — café 🌳',response:1,moment:2});
});
test('question title and order follow definition rather than answer insertion order',()=>{
 const qs=section([make()]).questions;assert.deepEqual(qs.map(q=>q.title),['Source','Senses','Rating','Moment evaluation','Why?']);
});
test('runtime prefixes never appear in fallback titles',()=>{
 assert.equal(readableKey('capture_42_c_unknown_field'),'Unknown field');const r=make();r.captures=[{id:1,reflection:{capture_42_c_unknown_field:'value'}}];assert.equal(section([r]).questions.find(q=>q.key==='capture_42_c_unknown_field').title,'c_unknown_field');
});
test('empty optional sections and no answers are safe',()=>{
 const r=make();r.sections[0].responses={};r.captures=[];assert.ok(buildResultsSummary([r],definitions)[0].sections.every(s=>s.questions.every(q=>q.count===0)));assert.deepEqual(buildResultsSummary([r],[])[0].sections,[]);assert.deepEqual(buildResultsSummary([],definitions),[]);
});
test('different questionnaire dates and incomplete metadata are never merged',()=>{
 const a=make(),b=make('r2');b.questionnaire={...metadata,uploadedAt:'2026-09-07T10:00:00Z'};assert.equal(buildResultsSummary([a,b],definitions).length,2);
 a.questionnaire={name:'Unknown'};b.questionnaire={name:'Unknown'};assert.equal(buildResultsSummary([a,b],definitions).length,2);
});
test('bundled English titles and matrix labels resolve independently of active template',()=>{
 const survey=JSON.parse(readFileSync(new URL('../src/survey/template_base.json',import.meta.url),'utf8'));const r=make();r.questionnaire={name:'Bundled default questionnaire'};r.sections[0].responses={p1_idade:'25-34'};r.captures=[{id:1,reflection:{c_metricas:{comfort:4}}}];const g=buildResultsSummary([r],[{metadata:r.questionnaire,survey}])[0];assert.equal(g.sections[0].questions[0].title,'Age Range');assert.equal(g.sections[1].questions.find(q=>q.key==='c_metricas').answers[0].title,'Level of comfort');
});
test('boolean uses pie; known text stays text even with repeated short values',()=>{
 const r=make();r.sections[0].responses={consent:true,word:'Yes'};const d=[{metadata,survey:{pages:[{name:'participant_information',title:'Participant profile',elements:[{name:'consent',type:'boolean'},{name:'word',type:'text'}]}]}}];const q=section([r],'Participant profile',d).questions;assert.equal(q[0].answers[0].kind,'pie');assert.equal(q[1].answers[0].kind,'text');
});
test('continuous numeric values have finite statistics rather than a forced chart',()=>{
 const r=make();r.captures=[{id:1,reflection:{n:1.2}},{id:2,reflection:{n:2.8}}];const a=answer([r],'n');assert.equal(a.kind,'numeric');assert.equal(a.average,2);assert.equal(a.min,1.2);assert.equal(a.max,2.8);
});

test('numeric category codes are counted without an inappropriate average',()=>{
 const r=make();r.captures[0].reflection.choice=1;r.captures[1].reflection.choice=2;const a=answer([r],'choice');assert.equal(a.kind,'bars');assert.equal(a.average,undefined);
});
test('unanswered defined questions remain visible with zero responses',()=>{
 const r=make();r.sections[0].responses={};assert.equal(section([r],'Participant profile').questions[0].count,0);
});
