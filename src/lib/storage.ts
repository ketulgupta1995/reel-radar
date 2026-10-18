import { Title } from "@/types/title";
const K="reel-radar-v1"; export type State={watched:Title[];displayed:string[];shown:string[];watchlist:Title[]};
const empty=():State=>({watched:[],displayed:[],shown:[],watchlist:[]});
export const load=():State=>{try{const value=JSON.parse(localStorage.getItem(K)||"");return value?{...empty(),...value}:empty()}catch{return empty()}}; export const save=(s:State)=>localStorage.setItem(K,JSON.stringify(s)); export const reset=()=>localStorage.removeItem(K);
