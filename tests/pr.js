let arr = [1,2,3,4,5];

for(let i = 0; i< arr.length; i++){
    for (let j = i; j < arr.length; j++) {
        if (arr[i] + arr[j] === 6) {
            console.log(`Pair: ${arr[i]}, ${arr[j]}`);
          }
        
    }
}

let res = arr[4] + arr[5];
console.log(res);