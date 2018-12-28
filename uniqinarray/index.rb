# uniq
a = [1,2,1,3,4,5,3]

temp = []
a.each do |itm|
	temp.push(itm) unless temp.include?itm
end
puts temp

# uniq | less complexity
def find_uniq(elements)
    a = {}
    elements.each do |e|
        a[e]=1 unless a[e]
    end
  a
end
puts find_uniq([1,2,3,1,4,3])

# Find duplicate
def find_duplicates(elements)
    a = {}
    # Examine all elements in the array.
    elements.each do |e|
        # If the element is in the hash, it is a duplicate.
        if a[e]
          puts "Dupe exists for: #{e}" 
	else 
	  a[e]=1
	end
    end
end

find_duplicates([1,2,3,1,4,3])

# Count duplicates in array
# Magic of "itself" and "each_with_object"
arr = [1, 2, 4, 4, 4, 5, 6, 7, 7, 7]
puts arr.group_by(&:itself).each_with_object({}){ |(k,v), hash | hash[k]=v.size}
puts arr.reduce(Hash.new(0)) {|memo, x| memo[x] += 1; memo}
# => {1=>1, 2=>1, 4=>3, 5=>1, 6=>1, 7=>3}


