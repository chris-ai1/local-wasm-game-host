// Authors: Christian Reitwiessner
// A local import/backup panel; the game still owns its save/load dialogs.
export function filePanel(root, {list, importFile, exportFile, focus=()=>{}}) {
  const find=id=>root.querySelector(`[data-files="${id}"]`);
  let epoch=0,active=false,busy=false;
  const notice=text=>{find('status').textContent=text;};
  function controls(){for(const element of root.querySelectorAll('input,button,select'))element.disabled=!active||busy;find('download').disabled=!active||busy||!find('list').value;}
  async function refresh(){
    const current=epoch;if(!active)return;
    try{
      const paths=await list();if(current!==epoch)return;
      const selected=find('list').value;find('list').replaceChildren();
      for(const path of paths){const option=document.createElement('option');option.value=path;option.textContent=path;find('list').append(option);}
      if(paths.includes(selected))find('list').value=selected;
      controls();
    }catch(error){if(current===epoch)notice(`Local files: ${error.message}`);}
  }
  find('refresh').addEventListener('click',refresh);
  find('list').addEventListener('change',controls);
  find('import').addEventListener('change',async()=>{
    const current=epoch,files=[...find('import').files];if(!active||!files.length)return;
    busy=true;controls();
    try{
      const prefix=find('directory').value.trim().replace(/\/$/,'');
      for(const file of files){
        if(file.size>16*1024*1024)throw new Error('Local file exceeds 16 MiB.');
        const bytes=await file.arrayBuffer();if(current!==epoch)return;
        await importFile((prefix?prefix+'/':'')+file.name,bytes);if(current!==epoch)return;
      }
      notice(`Imported ${files.length} local file${files.length===1?'':'s'}. Use the game's load dialog to open them.`);
      await refresh();
    }catch(error){if(current===epoch)notice(`Import failed: ${error.message}`);}
    finally{if(current===epoch){busy=false;find('import').value='';controls();}}
  });
  find('download').addEventListener('click',async()=>{
    const current=epoch,path=find('list').value;if(!active||!path)return;
    busy=true;controls();
    try{
      const bytes=await exportFile(path);if(current!==epoch)return;
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=path.split('/').pop();anchor.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Backup downloaded to your device.');focus();
    }catch(error){if(current===epoch)notice(`Download failed: ${error.message}`);}
    finally{if(current===epoch){busy=false;controls();}}
  });
  return {
    start(directory=''){epoch++;active=true;busy=false;root.hidden=false;find('directory').value=directory;notice('Saved files stay in this browser. Download backups to keep a separate copy.');controls();return refresh();},
    stop(){epoch++;active=false;busy=false;root.hidden=true;find('list').replaceChildren();find('import').value='';controls();},
    refresh,
    warn(text){notice(`Local files: ${text}`);},
  };
}
