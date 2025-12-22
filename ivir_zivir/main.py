from fastapi import FastAPI, HTTPException
from typing import Dict 
#uvicorn main:app --reload
app = FastAPI()

users_db : Dict[str, dict] = {}



@app.get("/")
def root():
    return {"message": "Hello World"}

if False:
    @app.get("/hello/{name}")
    def say_hello(name: str):
        return {"message" : f"merhaba , {name}!"}

    @app.get("/topla")
    def topla(a: int, b: int):
        sonuc = a + b
        return {"a": a, "b": b, "toplam": sonuc}

from pydantic import BaseModel

class User(BaseModel):
    username : str 
    age : int 

class UserCreate(BaseModel):
    username : str 
    password : str
    age : int

class UserLogin(BaseModel):
    username : str 
    password : str

@app.post("/register", response_model=User)
def register (user_data: UserCreate):
    if user_data.username in users_db:
        raise HTTPException ( Status_code= 400 , detail = "bu kullanıcı zaten var..." )
    
    users_db[user_data.username] =  {
        "password" : user_data.password,
        "age" : user_data.age
    }

    return User(username=user_data.username, age= user_data.age)

@app.post("/login")
def login(credentials: UserLogin):
    user_record = users_db.get(credentials.username)

    if not user_record:
        raise HTTPException(status_code= 401, detail= "kullanıcı adı veya şifre hatalı!")
    
    if user_record["password"] != credentials.password:
        raise HTTPException(status_code = 401, detail = "kullanıcı adı veya şifre hatalı!")

    return {
        "ok" : True,
        "message" : "hoşgeldin ! giriş başarılı.",
        "username" : credentials.username,
    }

@app.get("/users/{username}", response_model = User)
def get_user(username : str):
    user_record = users_db.get(username)

    if not user_record:
        raise HTTPException(status_code = 404 , detail = "kullanıcı bulunamadı!")

    return User(username = username, age = user_record["age"])


@app.get("/profile/{username}")
def get_profile(username: str):
    user_record = users_db.get(username)
    if not user_record:
        raise HTTPException(status_code=404, detail="Kullanıcı yok.")

    return {
        "username": username,
        "yas": user_record["age"],
        "mesaj": f"{username} adlı kullanıcının profili."
    }







if False : 
    @app.post("/users")
    def create_user(user: User):
        mesaj = f"kullanıcı oluşturuldu: {user.username} , yaş: {user.age} "
        return {
            "ok" : True,
            "user" : user,
            "message" : mesaj
        }

    @app.get("/check_age/{age}")
    def check_user_age(age:int):
        if (age < 18) : 
            return {f"sen burdan geçemen! {age}"}
        else:
            return {f"hoşgeldin! {age}"}


