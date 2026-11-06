/** Previous clients can still manage imported images and select a reaction by keyword. */
import { listGallery, galleryBytes, changeGallery, visibleImage } from './gallery.js'
export { listGallery as listStickers, galleryBytes as stickerBytes }
export async function changeSticker(root,input) {
  await changeGallery(root,input)
  return listGallery(root)
}
export function matchSticker(root,keywords,scope={}) {
  const items=listGallery(root).filter(i=>visibleImage(i,scope)).map(item=>{
    const note=item.description.normalize('NFKC').toLowerCase()
    return {item,note,label:note.split('|',1)[0].trim()}
  })
  const terms=keywords.map(word=>word.normalize('NFKC').toLowerCase())
  for(const matches of [(e,k)=>e.label===k,(e,k)=>k.length>1&&e.label.includes(k),(e,k)=>k.length>1&&e.note.includes(k)])
    for(const term of terms){const hit=items.find(e=>matches(e,term));if(hit)return hit.item}
  return null
}
