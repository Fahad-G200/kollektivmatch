import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as matching from '../match.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('A late search cannot replace the featured IDs used by the current search or next page', async () => {
  const olderFeatured = deferred();
  const olderStarted = deferred();
  const calls = [];
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { innerHTML:'', textContent:'', disabled:false,
      classList: { add(){}, remove(){}, toggle(){} }, addEventListener(){}, querySelectorAll(){return [];},
      insertAdjacentHTML(_position, html){ this.innerHTML += html; },
    });
    return elements.get(id);
  } };
  class Query {
    constructor() { this.city=''; this.featured=false; this.excluded=''; this.offset=0; }
    select(){ return this; }
    eq(field,value){ if (field === 'is_featured') this.featured=value; return this; }
    gt(){return this;}
    or(value){this.city += value; return this;}
    lte(){return this;}
    contains(){return this;}
    not(_field,_op,value){this.excluded=value; return this;}
    order(){return this;}
    limit(){return this;}
    range(offset){this.offset=offset;return this;}
    then(resolve,reject) {
      calls.push({city:this.city,featured:this.featured,excluded:this.excluded,offset:this.offset});
      if(this.featured && this.city.includes('Oslo')) { olderStarted.resolve(); return olderFeatured.promise.then(resolve,reject); }
      return Promise.resolve(this.featured
        ? {data:[{id:'bergen-featured',price:7000,title:'Synthetic example',city:'Bergen'}],error:null}
        : {data:[],count:20,error:null}).then(resolve,reject);
    }
  }
  const context = { ...matching, document, console,
    supabase:{auth:{getUser:async()=>({data:{user:null}})},from:()=>new Query()},
    showToast(){}, selectExampleListings:()=>[], formatDistance:()=>'',
    safePublicMediaUrl:(_url,_bucket,fallback)=>fallback||'', installImageFallback(){},
    LISTING_IMAGES_BUCKET:'listing-images',PROFILE_AVATARS_BUCKET:'profile-avatars',
  };
  const source=readFileSync(new URL('../feed.js',import.meta.url),'utf8')
    .replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
  runInNewContext(source,context);
  const older=context.loadListings({city:'Oslo'});
  await olderStarted.promise;
  await context.loadListings({city:'Bergen'});
  olderFeatured.resolve({data:[{id:'oslo-featured'}],error:null});
  assert.equal((await older).stale,true);
  await context.loadMoreListings();
  const nextPage=calls.find(x=>x.city.includes('Bergen')&&!x.featured&&x.offset===12);
  assert.equal(nextPage.excluded,'(bergen-featured)');
  assert.doesNotMatch(nextPage.excluded,/oslo/);
});
