// Authors: Christian Reitwiessner
// Optional integration check against the user's local Patrizier build/data.
// Production hosting stays independent of these game-specific inputs.
import assert from 'node:assert/strict';
export function originalMenu(game){
  const a=game.api;
  assert.equal(a.game_file_kind(),2);assert.equal(a.game_file_limit(),0);
  const path=new TextDecoder().decode(game.range(a.game_file_path_ptr(),a.game_file_path_len()));
  assert.equal(path,'s/startup-sequence');
  a.input_resize(0);game.check(a.game_file_reply(0),'Installed-mode probe failed');
  assert.match(game.snapshot().status,/Vorspann/);
  game.tick(1600);assert.match(game.input(4,0,0).status,/Kartenfrage/);
  assert.match(game.input(2,0,0).status,/sehr gut/);
  const menu=game.input(2,0,0);assert.match(menu.status,/Hauptmenü/);
  return menu;
}
