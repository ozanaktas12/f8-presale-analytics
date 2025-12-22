liste = [4,6,7,2,9,10,5,3]
n = len(liste)

for i in range(n) :
    for j in range(0, n - i -1):
        if liste[j] > liste[j+1]:
            liste[j] , liste[j+1] = liste[j+1] , liste[j]


#print(liste)







def bubble_sort(): 
    liste2= [6, 3, 8, 2]
    n = len(liste2)
    for i in range(n-1):
        print(f"{i} . tur:")
        print(f"güncel liste: {liste2}")
        for j in range(0, n -i -1):
            print(f"bu turki j değeri : {j} ")
            if liste2[j] > liste2[j+1] :
                print(f"{liste2[j]} ve {liste2[j+1]} değiştirilecek") 
                liste2[j] , liste2[j+1] = liste2[j+1] , liste2[j]
                print(f"{liste2[j]} ve {liste2[j+1]} değişti ")
            else: 
                print(f"bu tur değişim olmadı {liste2[j]} aynı")

    return (liste2) 

print(bubble_sort())





    
