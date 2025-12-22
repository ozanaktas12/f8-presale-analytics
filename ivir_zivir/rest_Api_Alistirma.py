from fastapi import FastAPI, HTTPException

app= FastAPI()
#uvicorn rest_Api_Alistirma:app --reload
@app.get("/")
def hello():
   return { "merhaba":"arkiişar"}

@app.get("/ozan")
def pırt(ozan : str): 

   return {"ozan" : ozan}

@app.post("/adar")
def port(adar: str, kardes: int):
   return {
      "adar" : adar*2, 
      "kardes" : kardes*2
   }

@app.get("/ap_denemece")
def kart(x : int, y : int, z : int ):

      liste_baba= [x,y,z]

      for i in liste_baba:
         if i > liste_baba[0]:
            liste_baba[0]= i

         
      return {"x" : x , "y": y, "z": z , "liste babu" : liste_baba}

               

   


