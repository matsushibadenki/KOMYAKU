export const valueType=value=>value===null?'null':typeof value==='string'?'text':typeof value==='number'?'number':typeof value==='boolean'?'boolean':'json';
export function parseStateValue(type,input){
 if(type==='text')return input;
 if(type==='null')return null;
 if(type==='number'){if(!input.trim())throw new Error('stateInvalidValue');const value=Number(input);if(!Number.isFinite(value))throw new Error('stateInvalidValue');return value;}
 if(type==='boolean'){if(!['true','false'].includes(input))throw new Error('stateInvalidValue');return input==='true';}
 if(type==='json')return JSON.parse(input);
 throw new Error('stateInvalidValue');
}
export const defaultStateValue=type=>({text:'',number:0,boolean:false,null:null,json:[]})[type];
