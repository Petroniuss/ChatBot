const express = require('express');
const Loki    = require('lokijs');
const fetch   = require('node-fetch');
const { WebhookClient } = require('dialogflow-fulfillment');

const jsonMiddleware = express.json();

const app = express();
const db = new Loki('foo.db');

const tableReservations = db.addCollection('tableReservations');

const tables = db.addCollection('tables');

const menu = db.addCollection('menu');

const orders = db.addCollection('orders');

tables.insert([
    {tableSize: 2, id: 1},
    {tableSize: 2, id: 2},
    {tableSize: 3, id: 3},
    {tableSize: 3, id: 4},
    {tableSize: 3, id: 5},
    {tableSize: 3, id: 5},
    {tableSize: 3, id: 6},
    {tableSize: 5, id: 7},
    {tableSize: 7, id: 8},
    {tableSize: 9, id: 9}
]);


menu.insert([
    { type: 'PRZYSTAWKA', id: 1, description: 'Domowe pierogi ruskie z okrasą', price: 18},
    { type: 'PRZYSTAWKA', id: 2, description: 'Carpaccio z buraka z dodatkiem bryndzy', price: 19},
    { type: 'ZUPA', id: 3, description: 'Pomidorowa z lanymi kluseczkami', price: 18},
    { type: 'ZUPA', id: 4, description: 'Krem z białych warzyw', price: 19},
    { type: 'DANIE GŁÓWNE', id: 5, description: 'Kotlet shabowy z kostką, pieczonymi ziemniakami i zasmżaną kapustą', price: 29},
    { type: 'DANIE GŁÓWNE', id: 6, description: 'Filet z sandacza z sosem koperkowym i ziemniakami z wody', price: 31},
    { type: 'DESER', id: 7, description: 'Ciasto marchewkowe', price: 16},
    { type: 'DESER', id: 8, description: 'Szarlotka', price: 16},
]);



app.post('/api', jsonMiddleware, (req, resp) => {
    const agent = new WebhookClient({
        request: req,
        response: resp
    });

    const { parameters, contexts } = agent;

    const intentMap = new Map();

    intentMap.set('reserve table', async () => {
        const person = parameters['person'].name;
        const date   =  new Date(parameters['date']);
        const time   = new Date(parameters['time']);
        const tableSize = parseInt(parameters['tableSize']);

        freeTables = findFreeTables(date, time, tableSize);

        if (checkIfPast(date, time)) {
            agent.add(`
                Nie można robić rezerwacji na przeszłość!
            `);
        }
        else if (time.getHours() < 10 || time.getHours() > 22) {
            agent.add(`
                Nasza restauracja jest czynna między 10:00 a 22:00
            `);
        } else if (freeTables.length == 0) {
            agent.add(`
                Niestety, wszystkie stoliki mogące pomieścić tyle osób są już zajęte.\n
                Możesz spróbować zarezerwować kilka stolików dla mniejszej ilości osób.
            `);
        } else {
            tableReserv = {
                person: person,
                date  : date,
                time  : time, 
                tableSize : tableSize,
                tableId  : freeTables[0].id
            };

            tableReservations.insert(tableReserv);

            agent.add(`
                Pomyślnie zarezerwowałeś stolik! Oczekujemy Cię o
                ${time.toLocaleTimeString("pl-PL", {hour: '2-digit', minute:'2-digit'})},
                ${date.toLocaleDateString("pl-PL")}, do zobaczenia! 
            `);
        }
    });

    intentMap.set('cancel table reservation', async () => {
        const person = parameters['person'].name;
        const date   =  new Date(parameters['date']);
        const time   = new Date(parameters['time']);

        if (checkIfPast(date, time)) {
            agent.add(`
                Nie można anulować przeszłych rezerwacji!
            `);
        } else {
            const count = countReservations(person, date, time);
            removeReservations(person, date, time);

            if (count < 1) {
                agent.add(`
                    Ups! Nie znaleziono żadnych rezerwacji!
                `);
            }
            else if (count < 2) {
                agent.add(`
                    Pomyślnie usunięto rezerwację.
                `);
            } else {
                agent.add(`
                    Usunięto wszystkie Twoje rezerwacje na podaną godzinę. 
                `);
            }
        }

    });

    intentMap.set('free tables query', async () => {
        const date   =  new Date(parameters['date']);
        const time   = new Date(parameters['time']);
        const minTableSize = parseInt(parameters['tableSize']);

        freeTables = findFreeTables(date, time, minTableSize);
        freeTablesNumber = freeTables.length;

        if (time.getHours() < 10 || time.getHours() > 22) {
            agent.add(`
                Nasza restauracja jest czynna między 10:00 a 22:00.
            `);
        }
        else if (freeTablesNumber < 1) {
            agent.add(`
                Nie ma żadnych wolnych stolików. 
            `);
        } else if (freeTablesNumber == 1) {
            agent.add(`
                Mamy jeden wolny stolik. 
            `);
        } else if (freeTablesNumber < 5) {
            agent.add(`
                Mamy ${freeTablesNumber} wolne stoliki. 
            `);
        } else {
            agent.add(`
                Mamy ${freeTablesNumber} wolnych stolików. 
            `);
        }
    });

    intentMap.set('describe menu', async () => {
        const types = parameters['menuType'];
        const response = formatMenuByTypes(types);

        agent.add(`Do zaoferowania mamy \n${response}`);
    });

    intentMap.set('dish price query', async () => {
        const dishId = parseInt(parameters['dishId']);

        const dishes = menu.where(dish => dish.id === dishId);
        if (dishes.length < 1) {
            agent.add(`Do zaoferowania mamy pozycje od 1 do ${menu.count()}`);
        } else {
            const dish = dishes[0];
            agent.add(`Pozycja ${dish.id}. ${dish.description} kosztuje ${dish.price} zł`);
        }
    });

    intentMap.set('order take-out', async () => {
        const limit = menu.count();

        const person = parameters['person'].name;
        const date   =  new Date(parameters['date']);
        const time   = new Date(parameters['time']);
        const dishIds = parameters['dishIds']
                        .map(parseInt)
                        .filter(dishId => dishId >= 1 && dishId <= limit);

        const ordered = [];
        var   totalPrice = 0;
        for (let dishId of dishIds) {
            const dish = menu.findOne(dish => dish.id === dishId);

            ordered.push(dishId);
            totalPrice += dish.price;
        }

        console.log(`Dishids: ${dishIds}`);
        console.log(`TotalPrice: ${totalPrice}`);


        if (ordered.length < 1) {
            agent.add(`
                Nie udało się złożyć zamówienia! Oferujemy pozycje między 1 a ${limit}!
            `);
        } else {
            const order = {
                orderedDishes: ordered,
                totalPrice   : totalPrice,
                person       : person,
                time         : time,
                date         : date
            };

            orders.insert(order);

            agent.add(`
                Pomyślnie złożyłeś zamówienie! Zamówienie możesz odebrać o
                ${time.toLocaleTimeString("pl-PL", {hour: '2-digit', minute:'2-digit'})},
                ${date.toLocaleDateString("pl-PL")}, Cena za całość to ${totalPrice}zł. Do zobaczenia! 
            `);
        }
    });

    intentMap.set('order expected wait time query', async () => {
        const date   =  new Date(parameters['date']);
        const time   = new Date(parameters['time']);

        const orderCount = countOrders(date, time);

        if (orderCount < 1) {
            agent.add(`
                Nie ma żadnych zamówień! Możesz spodziewać się swojego zamówienia punktualnie.
            `);
        }
        else if (orderCount < 20) {
            agent.add(`
                Mamy kilka zamówień $(orderCount), ale nie powinno być żadnych opóźnień
            `);
        } 
        else {
            agent.add(`
                Mamy ${orderCount} zamówień! Możesz spodziewać się opóźnień. 
            `);
        }
    });

    intentMap.set('donald trump quotes', async () => {
        const resp = await fetch('https://api.tronalddump.io/random/quote', {
            method: 'GET',
            headers: {
                'Accept': 'application/hal+json'
            }
        }).then(resp => resp.json());

        agent.add(resp.value);
    });

    agent.handleRequest(intentMap);
})


app.get('/', (req, resp) => {
    resp.sendFile('index.html', { root: __dirname + '/static/'});
})

app.use(express.static('./static/'));

app.listen(process.env.PORT || 8080);


function findFreeTables(date, time, minTableSize) {
    const taken = tableReservations.where((res) => {
        return res.date.getTime() === date.getTime() &&
               timeOverlaps(time, res.time) && 
               res.tableSize >= minTableSize
    });

    return tables.where((d) => d.tableSize >= minTableSize)
          .filter(table => !taken.some(reserv => reserv.tableId == table.id))
          .sort((a, b) => a.tableSize - b.tableSize);
}

function countOrders(date, time) {
    return orders.where((order) => {
        return order.date.getTime() === date.getTime() &&
               timeOverlaps(time, order.time, hours = .5)
    }).length;
}

function countReservations(person, date, time) {
    return tableReservations.where((res) => {
        return res.date.getTime() === date.getTime() && 
               res.time.getTime() == time.getTime() &&
               res.person === person
    }).length;
}

function removeReservations(person, date, time) {
    tableReservations
        .chain()
        .find((res) => {
            return res.date.getTime() === date.getTime() && 
                res.time.getTime() == time.getTime() &&
                res.person === person
        })
        .remove();
}

function formatMenuByTypes(types) {
    res = "";
    for (let type of types) {
        // res += `${type}: \n`;
        res += formatMenuByType(type);
    }

    return res;
}

function formatMenuByType(type) {
    dishes = menu.where(d => d.type === type).sort((a, b) => a.id - b.id);
    res = "";

    for (let dish of dishes) {
        res += `${dish.id}. ${dish.description}\n`
    }

    return res;
}

function timeOverlaps(time1, time2,  hours = 2) {
    mins1 = time1.getHours() * 60 + time1.getMinutes();
    mins2 = time2.getHours() * 60 + time2.getMinutes();
    
    return Math.abs(mins1 - mins2) < hours * 60;
}    


function checkIfPast(date, time) {
    const d1 = new Date();
    const d2 = new Date(date);

    d2.setMinutes(time.getMinutes())
    d2.setHours(time.getHours())

    return d1.getTime() > d2.getTime();
}