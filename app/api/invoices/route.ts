import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireIdentity, requireOwner, rejectOtherBusiness, errorStatus, IdentityError } from "@/src/lib/identity";
import { createInvoiceIntake, getCurrentState } from "@/src/lib/store";
import { runPersistedProcessing } from "@/src/lib/invoice-processing";
import type { InvoiceIntake } from "@/src/lib/types";
export const runtime="nodejs";
const LIMIT=5*1024*1024;
function checkJpegDimensions(bytes:Buffer) {
  let at=2;
  while(at+4<bytes.length) {
    if(bytes[at]!==255){at++;continue;}
    const marker=bytes[at+1];at+=2;
    if(marker===0xda||marker===0xd9)break;
    if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    const length=bytes.readUInt16BE(at);
    if(length<2||at+length>bytes.length)break;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7) {
      const pixels=bytes.readUInt16BE(at+3)*bytes.readUInt16BE(at+5);
      if(pixels>0&&pixels<=16_000_000)return;
      throw new Error("JPEG dimensions exceed the 16-megapixel processing limit.");
    }
    at+=length;
  }
  throw new Error("JPEG image dimensions could not be validated.");
}
async function boundedForm(request:Request) {
  if(!request.body)throw new Error("Choose an invoice document.");
  const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT+65536){await reader.cancel();throw new IdentityError("Invoice upload exceeds 5 MB.",413);}chunks.push(value);}
  return new Request(request.url,{method:"POST",headers:{"Content-Type":request.headers.get("content-type")??""},body:Buffer.concat(chunks)}).formData();
}
export async function POST(request:Request) {
  try {
    const identity=await requireIdentity(request);requireOwner(identity);
    const form=await boundedForm(request);
    rejectOtherBusiness(form.get("businessId")??undefined,identity);
    const file=form.get("file");
    if(!(file instanceof File)||!file.size||file.size>LIMIT)throw new Error("Choose an invoice between 1 byte and 5 MB.");
    const contents=Buffer.from(await file.arrayBuffer());
    const fileName=file.name.replace(/[^\w.\- ()]/g,"_").slice(0,120)||"invoice";
    const extension=fileName.split(".").pop()?.toLowerCase();
    let mimeType:InvoiceIntake["mimeType"];
    if(extension==="pdf"&&contents.subarray(0,5).toString("ascii")==="%PDF-")mimeType="application/pdf";
    else if(extension==="csv"){
      new TextDecoder("utf-8",{fatal:true}).decode(contents);
      if(contents.includes(0))throw new Error("CSV must contain plain UTF-8 text.");
      mimeType="text/csv";
    }else if(extension==="png"&&contents.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
      if(contents.length<24||contents.readUInt32BE(16)*contents.readUInt32BE(20)>16_000_000)throw new Error("Image dimensions exceed the processing limit.");
      mimeType="image/png";
    }else if((extension==="jpg"||extension==="jpeg")&&contents[0]===255&&contents[1]===216&&contents[2]===255){checkJpegDimensions(contents);mimeType="image/jpeg";}
    else throw new Error("Upload a valid PDF, UTF-8 CSV, PNG, or JPEG invoice.");
    const requestId=form.get("requestId");
    if(typeof requestId!=="string"||!/^[\w-]{8,100}$/.test(requestId))throw new Error("A valid upload request reference is required.");
    const sha256=createHash("sha256").update(contents).digest("hex");
    const previous=await getCurrentState(identity.businessId);
    const repeated=previous.state.invoiceIntakes.find(i=>i.uploadRequestId===requestId);
    if(repeated) {
      if(repeated.sha256!==sha256)throw new Error("This upload reference belongs to another document.");
      return NextResponse.json(previous,{headers:{"Cache-Control":"private, no-store"}});
    }
    const now=new Date().toISOString();
    const intake:InvoiceIntake={id:`invoice-${randomUUID()}`,fileName,mimeType,fileSizeBytes:file.size,sha256,uploadedAt:now,status:"review",processingStatus:"processing",processingStartedAt:now,proposals:[],warnings:[],simulated:false,uploadRequestId:requestId};
    const uploaded=await createInvoiceIntake(identity.businessId,intake,contents,identity.role);
    // A concurrent retry may have won the same upload identity while this request waited for the row lock.
    const stored=uploaded.state.invoiceIntakes.find(i=>i.uploadRequestId===requestId)!;
    if(stored.id!==intake.id)return NextResponse.json(uploaded,{headers:{"Cache-Control":"private, no-store"}});
    const result=await runPersistedProcessing(identity,intake.id,false,now);
    return NextResponse.json(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invoice could not be uploaded."},{status:errorStatus(error)});}
}
