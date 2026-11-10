// Authors: Christian Reitwiessner
// Optional module-supplied controls. All content is text; actions are opaque.
export function validatePanel(panel) {
  const string=(v,max=4096)=>typeof v==='string'&&v.length<=max;
  const integer=(v,max=0xffffffff)=>Number.isInteger(v)&&v>=0&&v<=max;
  if(!panel||!integer(panel.revision)||!string(panel.title,256)||!string(panel.description)||!string(panel.notice)||typeof panel.replaceScreen!=='boolean'||!Array.isArray(panel.actions)||!Array.isArray(panel.rows)||panel.rows.length>128)throw new Error('Invalid game controls.');
  if(panel.field!==null){const f=panel.field;if(!f||!string(f.key,256)||!string(f.label,256)||!string(f.value,1024)||typeof f.number!=='boolean'||!integer(f.maximum)||(!f.number&&f.maximum>1024))throw new Error('Invalid game input field.');}
  const ids=new Set();let count=0;
  const actions=items=>{
    if(!Array.isArray(items)||items.length>256)throw new Error('Invalid game actions.');
    for(const a of items){if(!a||!integer(a.id)||ids.has(a.id)||!string(a.label,256)||typeof a.enabled!=='boolean'||typeof a.usesField!=='boolean'||typeof a.active!=='boolean'||(a.usesField&&!panel.field)||++count>512)throw new Error('Invalid game action.');ids.add(a.id);}
  };
  actions(panel.actions);
  for(const row of panel.rows){if(!row||!string(row.title,256)||!string(row.detail))throw new Error('Invalid game row.');actions(row.actions);}
  return panel;
}

export function gamePanel(element,{send}) {
  let previous=null,previousTitle;
  const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
  return panel=>{
    const signature=JSON.stringify(panel);
    if(signature===previous)return;
    const oldInput=element.querySelector('input');
    const sameField=oldInput&&panel?.field&&oldInput.dataset.key===panel.field.key;
    const draft=sameField?oldInput.value:undefined;
    const focused=oldInput&&document.activeElement===oldInput;
    const selection=focused&&oldInput.type==='text'?[oldInput.selectionStart,oldInput.selectionEnd]:null;
    const scroll=previousTitle===panel?.title?element.scrollTop:0;
    previousTitle=panel?.title;
    element.replaceChildren();previous=signature;element.hidden=!panel;
    element.dataset.revision=panel?String(panel.revision):'';
    if(!panel)return;
    element.append(node('h2',panel.title));
    if(panel.description)element.append(node('p',panel.description,'game-ui-description'));
    let input;
    const form=node('form');
    if(panel.field){
      const f=panel.field,label=node('label',f.label);input=node('input');
      input.type=f.number?'number':'text';input.inputMode=f.number?'numeric':'text';input.dataset.key=f.key;
      input.autocomplete='off';input.autocapitalize='characters';input.spellcheck=false;
      if(f.number){input.min='0';input.max=String(f.maximum);input.step='1';}else input.maxLength=f.maximum;
      input.value=draft??f.value;label.append(input);form.append(label);
    }
    const invoke=action=>{
      if(action.usesField&&!input.reportValidity())return;
      send({id:action.id,revision:panel.revision,value:action.usesField?input.value:''});
    };
    const buttons=items=>{const group=node('div',undefined,'game-ui-actions');for(const action of items){
      const b=node('button',action.label);b.type='button';b.disabled=!action.enabled;
      if(action.active)b.setAttribute('aria-pressed','true');
      b.addEventListener('click',()=>invoke(action));group.append(b);
    }return group;};
    form.append(buttons(panel.actions));
    form.addEventListener('submit',event=>{event.preventDefault();const action=panel.actions.find(a=>a.enabled&&a.usesField);if(action)invoke(action);});
    element.append(form);
    if(panel.notice){const notice=node('p',panel.notice,'game-ui-notice');notice.setAttribute('role','alert');element.append(notice);}
    const rows=node('div',undefined,'game-ui-rows');
    for(const row of panel.rows){const article=node('article');article.append(node('h3',row.title),node('p',row.detail),buttons(row.actions));rows.append(article);}
    if(panel.rows.length)element.append(rows);
    element.scrollTop=scroll;
    if(focused&&input){input.focus({preventScroll:true});if(selection)input.setSelectionRange(...selection);}
  };
}
