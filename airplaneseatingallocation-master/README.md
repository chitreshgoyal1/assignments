# airplaneseatingallocation
Airplane seating allocation
        
    Write a program that helps seat audiences in a flight based on the following input and rules.
      1. Always seat passengers starting from the front row to back, starting from the left to right
      2. Fill aisle seats first followed by window seats followed by center seats
      3. If the window block has only one column then the seats in that block should be considered as Aisle

    Input Format
      The first line contains number of passengers waiting in queue 'N'.
      Each of the next lines contains space-separated integers that specify the column 'C' and rows 'R' in each blocks respectively.

    Constraints
      0 <=N <10^7
      0 < C, R < 1000

    Output format
      1. Print the passenger number as 3 digit padding with leading zeros.
      2. Seperate the blocks with "|"
      3. If the seat is empty mark it as follow
        -A- : Aisle
        -W- : Window
        -C- : Center
        --- : No Seat

    Sample Input
      30
      3 2
      4 3
      2 3
      3 4

    Sample Output
      019 025 001 002 026 027 003 004 005 006 028 020
      021 029 007 008 030 -C- 009 010 011 012 -C- 022
      --- --- --- 013 -C- -C- 014 015 016 017 -C- 023
      --- --- --- --- --- --- --- --- --- 018 -C- 024

